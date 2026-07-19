import {
  CascadedShadowGenerator,
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  Vector3,
  Vector4,
} from "@babylonjs/core";
import {
  FACADE_STYLES,
  FACADE_TILE_METERS,
  GRASS_TILE_METERS,
  ROAD_TILE_METERS,
  SIDEWALK_TILE_METERS,
  createCloudSprite,
  createFacadeTexture,
  createGlowSprite,
  createGrassTexture,
  createRoadTexture,
  createSidewalkTexture,
  createSkyGradient,
} from "./Textures";

interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const GRID_RADIUS = 8;
const BLOCK_PITCH = 150;
const BLOCK_SIZE = 110;
const LOT_OFFSET = 28;
const GROUND_Y = -0.18;
const BLOCK_TOP = 0.33;

/** Direction the sunlight travels; a low warm late-afternoon sun. */
const SUN_DIRECTION = new Vector3(-0.46, -0.72, 0.34).normalize();

export class City {
  readonly extent = (GRID_RADIUS + 0.7) * BLOCK_PITCH;
  readonly start = new Vector3(75, 1.1, 75);
  readonly checkpointRoute = [
    new Vector3(75, 1.2, 75),
    new Vector3(825, 1.2, 75),
    new Vector3(825, 1.2, 825),
    new Vector3(75, 1.2, 825),
    new Vector3(-825, 1.2, 825),
    new Vector3(-825, 1.2, -825),
    new Vector3(75, 1.2, -825),
    new Vector3(825, 1.2, -825),
  ];
  readonly enemySpawns = [
    new Vector3(375, 3, 75),
    new Vector3(825, 3, 375),
    new Vector3(525, 3, 825),
    new Vector3(-375, 3, 825),
    new Vector3(-825, 3, 225),
    new Vector3(-825, 3, -525),
    new Vector3(-225, 3, -825),
    new Vector3(675, 3, -825),
    new Vector3(75, 3, 525),
    new Vector3(-525, 3, 75),
    new Vector3(75, 3, -375),
    new Vector3(375, 3, -375),
  ];

  private readonly colliders: Collider[] = [];
  private shadows: CascadedShadowGenerator | null = null;

  constructor(readonly scene: Scene) {
    this.build();
  }

  addShadowCaster(mesh: Mesh): void {
    this.shadows?.addShadowCaster(mesh);
  }

  moveWithCollisions(position: Vector3, delta: Vector3, radius: number): Vector3 {
    const distance = delta.length();
    const steps = Math.max(1, Math.ceil(distance / 2.5));
    const step = delta.scale(1 / steps);
    const result = position.clone();

    for (let i = 0; i < steps; i += 1) {
      const nextX = clamp(result.x + step.x, -this.extent, this.extent);
      if (!this.intersects(nextX, result.z, radius)) result.x = nextX;

      const nextZ = clamp(result.z + step.z, -this.extent, this.extent);
      if (!this.intersects(result.x, nextZ, radius)) result.z = nextZ;
    }

    result.y = 1.1;
    return result;
  }

  nearestRoad(position: Vector3): Vector3 {
    const roadX = snapRoad(position.x);
    const roadZ = snapRoad(position.z);
    const dx = Math.abs(roadX - position.x);
    const dz = Math.abs(roadZ - position.z);
    const safe = position.clone();

    if (dx < dz) safe.x = roadX;
    else safe.z = roadZ;

    safe.x = clamp(safe.x, -this.extent + 10, this.extent - 10);
    safe.z = clamp(safe.z, -this.extent + 10, this.extent - 10);
    safe.y = 1.1;
    return safe;
  }

  private intersects(x: number, z: number, radius: number): boolean {
    for (const box of this.colliders) {
      if (
        x + radius > box.minX &&
        x - radius < box.maxX &&
        z + radius > box.minZ &&
        z - radius < box.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  private build(): void {
    const { scene } = this;
    const random = mulberry32(0xfda2026);

    scene.clearColor = new Color4(0.66, 0.72, 0.78, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.74, 0.78, 0.81);
    scene.fogDensity = 0.00026;

    this.buildLights();
    this.buildSky(random);

    const roadTexture = createRoadTexture(scene, random);
    roadTexture.anisotropicFilteringLevel = 8;
    const groundWidth = this.extent * 2 + 500;
    roadTexture.uScale = groundWidth / ROAD_TILE_METERS;
    roadTexture.vScale = groundWidth / ROAD_TILE_METERS;
    // Align tile edges with road centerlines at (i - 0.5) * BLOCK_PITCH.
    const tileShift = (groundWidth * 0.5 + BLOCK_PITCH * 0.5) / ROAD_TILE_METERS;
    roadTexture.uOffset = Math.ceil(tileShift) - tileShift;
    roadTexture.vOffset = roadTexture.uOffset;

    const asphalt = new StandardMaterial("asphalt", scene);
    asphalt.diffuseTexture = roadTexture;
    asphalt.specularColor = Color3.Black();

    const ground = MeshBuilder.CreateGround(
      "city-ground",
      { width: groundWidth, height: groundWidth, subdivisions: 1 },
      scene,
    );
    ground.position.y = GROUND_Y;
    ground.material = asphalt;
    ground.receiveShadows = true;
    ground.freezeWorldMatrix();

    const sidewalkMaterial = texturedMaterial(scene, "sidewalk", createSidewalkTexture(scene, random));
    const grassMaterial = texturedMaterial(scene, "park-grass", createGrassTexture(scene, random));
    grassMaterial.specularColor = Color3.Black();

    const trunkMaterial = flatMaterial(scene, "tree-trunk", "#4c3a2c");
    const leafMaterial = flatMaterial(scene, "tree-leaf", "#44582f");
    leafMaterial.specularColor = new Color3(0.02, 0.04, 0.02);
    const steelMaterial = flatMaterial(scene, "street-steel", "#3a3d40");
    steelMaterial.specularColor = new Color3(0.25, 0.25, 0.27);
    steelMaterial.specularPower = 48;
    const concreteMaterial = flatMaterial(scene, "civic-concrete", "#9d9a92");

    const carPaints = ["#b9bdc1", "#24272b", "#d6d7d3", "#6e2822", "#2c3d57", "#565b60"].map(
      (hex, index) => {
        const paint = flatMaterial(scene, `car-paint-${index}`, hex);
        paint.specularColor = new Color3(0.5, 0.5, 0.52);
        paint.specularPower = 64;
        return paint;
      },
    );
    const carGlass = flatMaterial(scene, "car-glass", "#161c22");
    carGlass.specularColor = new Color3(0.7, 0.72, 0.75);
    carGlass.specularPower = 96;
    const carDark = flatMaterial(scene, "car-underbody", "#141517");

    const buildingMaterials = FACADE_STYLES.map((style) => {
      const facade = new StandardMaterial(`facade-${style.name}`, scene);
      facade.diffuseTexture = createFacadeTexture(scene, style, random);
      facade.specularColor = style.spandrel
        ? new Color3(0.32, 0.34, 0.36)
        : new Color3(0.06, 0.06, 0.06);
      facade.specularPower = style.spandrel ? 72 : 24;
      return facade;
    });

    const sidewalks: Mesh[] = [];
    const buildingGroups: Mesh[][] = buildingMaterials.map(() => []);
    const grassParts: Mesh[] = [];
    const trunkParts: Mesh[] = [];
    const leafParts: Mesh[] = [];
    const steelParts: Mesh[] = [];
    const carPaintParts: Mesh[][] = carPaints.map(() => []);
    const carGlassParts: Mesh[] = [];
    const carDarkParts: Mesh[] = [];

    const blockUv = new Vector4(0, 0, BLOCK_SIZE / SIDEWALK_TILE_METERS, BLOCK_SIZE / SIDEWALK_TILE_METERS);
    const blockSideUv = new Vector4(0, 0, BLOCK_SIZE / SIDEWALK_TILE_METERS, 0.12);
    const blockFaceUv = [blockSideUv, blockSideUv, blockSideUv, blockSideUv, blockUv, blockUv];
    const grassUv = new Vector4(0, 0, BLOCK_SIZE / GRASS_TILE_METERS, BLOCK_SIZE / GRASS_TILE_METERS);
    const grassFaceUv = [blockSideUv, blockSideUv, blockSideUv, blockSideUv, grassUv, grassUv];

    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx += 1) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz += 1) {
        const centerX = gx * BLOCK_PITCH;
        const centerZ = gz * BLOCK_PITCH;
        const isPlaza = gx === 1 && gz === 1;
        const isPark = !isPlaza && random() < 0.075 && Math.abs(gx) + Math.abs(gz) > 2;

        const block = MeshBuilder.CreateBox(
          `block-${gx}-${gz}`,
          {
            width: BLOCK_SIZE,
            depth: BLOCK_SIZE,
            height: 0.5,
            faceUV: isPark ? grassFaceUv : blockFaceUv,
          },
          scene,
        );
        block.position.set(centerX, 0.08, centerZ);
        block.bakeCurrentTransformIntoVertices();
        (isPark ? grassParts : sidewalks).push(block);

        this.buildStreetlights(gx, gz, centerX, centerZ, steelParts);
        this.buildParkedCars(
          random,
          centerX,
          centerZ,
          carPaintParts,
          carGlassParts,
          carDarkParts,
        );

        if (isPlaza) {
          this.buildSpire(centerX, centerZ, concreteMaterial, steelMaterial);
          continue;
        }

        if (isPark) {
          for (let tree = 0; tree < 7; tree += 1) {
            const x = centerX + (random() - 0.5) * 78;
            const z = centerZ + (random() - 0.5) * 78;
            this.buildTree(random, x, z, trunkParts, leafParts);
          }
          continue;
        }

        for (const ox of [-LOT_OFFSET, LOT_OFFSET]) {
          for (const oz of [-LOT_OFFSET, LOT_OFFSET]) {
            const width = 40 + random() * 8;
            const depth = 40 + random() * 8;
            const centrality = 1 - Math.min(1, Math.hypot(gx, gz) / (GRID_RADIUS * 1.15));
            const height = 22 + random() * 60 + random() * random() * 120 * centrality;
            const x = centerX + ox;
            const z = centerZ + oz;
            const group = Math.floor(random() * buildingMaterials.length);
            const parts = buildingGroups[group] ?? buildingGroups[0]!;

            const tower = MeshBuilder.CreateBox(
              `tower-${gx}-${gz}-${ox}-${oz}`,
              { width, depth, height, faceUV: facadeUv(width, depth, height) },
              scene,
            );
            tower.position.set(x, height * 0.5 + BLOCK_TOP, z);
            tower.bakeCurrentTransformIntoVertices();
            parts.push(tower);

            // Rooftop mechanical penthouse on taller towers.
            if (height > 55 && random() < 0.7) {
              const boxW = width * (0.25 + random() * 0.2);
              const boxD = depth * (0.25 + random() * 0.2);
              const boxH = 2.5 + random() * 3;
              const roofBox = MeshBuilder.CreateBox(
                `roofbox-${gx}-${gz}-${ox}-${oz}`,
                { width: boxW, depth: boxD, height: boxH, faceUV: plainUv() },
                scene,
              );
              roofBox.position.set(
                x + (random() - 0.5) * width * 0.3,
                height + BLOCK_TOP + boxH * 0.5,
                z + (random() - 0.5) * depth * 0.3,
              );
              roofBox.bakeCurrentTransformIntoVertices();
              parts.push(roofBox);
            }

            if (height > 100 && random() < 0.5) {
              const mast = MeshBuilder.CreateCylinder(
                `mast-${gx}-${gz}-${ox}-${oz}`,
                { height: 10 + random() * 10, diameterTop: 0.18, diameterBottom: 0.5, tessellation: 6 },
                scene,
              );
              mast.position.set(x, height + BLOCK_TOP + 6, z);
              mast.bakeCurrentTransformIntoVertices();
              steelParts.push(mast);
            }

            this.colliders.push({
              minX: x - width * 0.5,
              maxX: x + width * 0.5,
              minZ: z - depth * 0.5,
              maxZ: z + depth * 0.5,
            });
          }
        }
      }
    }

    const staticMeshes: Mesh[] = [];
    const push = (merged: Mesh | null): void => {
      if (merged) staticMeshes.push(merged);
    };
    push(mergeGroup("sidewalks", sidewalks, sidewalkMaterial));
    push(mergeGroup("park-grass", grassParts, grassMaterial));
    push(mergeGroup("tree-trunks", trunkParts, trunkMaterial));
    push(mergeGroup("tree-canopies", leafParts, leafMaterial));
    push(mergeGroup("street-steel", steelParts, steelMaterial));
    push(mergeGroup("car-glass", carGlassParts, carGlass));
    push(mergeGroup("car-underbodies", carDarkParts, carDark));
    carPaintParts.forEach((parts, index) => {
      push(mergeGroup(`cars-${index}`, parts, carPaints[index] ?? carPaints[0]!));
    });
    buildingGroups.forEach((group, index) => {
      push(mergeGroup(`building-group-${index}`, group, buildingMaterials[index] ?? buildingMaterials[0]!));
    });

    for (const mesh of staticMeshes) {
      mesh.receiveShadows = true;
      this.shadows?.addShadowCaster(mesh);
    }
  }

  private buildLights(): void {
    const { scene } = this;

    const skyLight = new HemisphericLight("sky-light", new Vector3(0.1, 1, -0.05), scene);
    skyLight.intensity = 1.05;
    skyLight.diffuse = new Color3(0.68, 0.74, 0.84);
    skyLight.groundColor = new Color3(0.47, 0.44, 0.4);
    skyLight.specular = Color3.Black();

    const sun = new DirectionalLight("sun", SUN_DIRECTION.clone(), scene);
    sun.position = SUN_DIRECTION.scale(-900);
    sun.intensity = 2.4;
    sun.diffuse = new Color3(1, 0.88, 0.72);
    sun.specular = new Color3(1, 0.9, 0.76);

    const shadows = new CascadedShadowGenerator(1024, sun);
    shadows.numCascades = 2;
    shadows.lambda = 0.92;
    shadows.shadowMaxZ = 450;
    shadows.stabilizeCascades = true;
    shadows.bias = 0.01;
    shadows.normalBias = 0.02;
    shadows.setDarkness(0.3);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows = shadows;
  }

  private buildSky(random: () => number): void {
    const { scene } = this;

    const sky = MeshBuilder.CreateSphere(
      "sky-dome",
      { diameter: 5600, segments: 24, sideOrientation: Mesh.BACKSIDE },
      scene,
    );
    const skyMaterial = new StandardMaterial("sky-dome-material", scene);
    skyMaterial.emissiveTexture = createSkyGradient(scene);
    skyMaterial.diffuseColor = Color3.Black();
    skyMaterial.specularColor = Color3.Black();
    skyMaterial.disableLighting = true;
    skyMaterial.disableDepthWrite = true;
    sky.material = skyMaterial;
    sky.infiniteDistance = true;
    sky.applyFog = false;
    sky.isPickable = false;

    const sunSprite = createGlowSprite(
      scene,
      "sun-sprite",
      "rgba(255, 252, 240, 1)",
      "rgba(255, 232, 178, 0.55)",
      0.22,
    );
    const sunPlane = MeshBuilder.CreatePlane("sun-disc", { size: 720 }, scene);
    const sunMaterial = new StandardMaterial("sun-disc-material", scene);
    sunMaterial.diffuseTexture = sunSprite;
    sunMaterial.emissiveTexture = sunSprite;
    sunMaterial.useAlphaFromDiffuseTexture = true;
    sunMaterial.disableLighting = true;
    sunMaterial.disableDepthWrite = true;
    sunMaterial.alphaMode = 1; // additive: glow brightens the sky, never dims it
    sunPlane.material = sunMaterial;
    sunPlane.position = SUN_DIRECTION.scale(-2500);
    sunPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    sunPlane.infiniteDistance = true;
    sunPlane.applyFog = false;
    sunPlane.isPickable = false;

    const cloudSprite = createCloudSprite(scene, random);
    for (let i = 0; i < 8; i += 1) {
      const azimuth = random() * Math.PI * 2;
      const elevation = 0.14 + random() * 0.34;
      const direction = new Vector3(
        Math.cos(elevation) * Math.sin(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.cos(azimuth),
      );
      const cloud = MeshBuilder.CreatePlane(`cloud-${i}`, { width: 900 + random() * 900, height: 260 + random() * 220 }, scene);
      const cloudMaterial = new StandardMaterial(`cloud-material-${i}`, scene);
      cloudMaterial.diffuseTexture = cloudSprite;
      cloudMaterial.emissiveTexture = cloudSprite;
      cloudMaterial.useAlphaFromDiffuseTexture = true;
      cloudMaterial.disableLighting = true;
      cloudMaterial.disableDepthWrite = true;
      cloudMaterial.alphaMode = 1; // additive, same as the sun glow
      cloudMaterial.alpha = 0.5 + random() * 0.35;
      cloud.material = cloudMaterial;
      cloud.position = direction.scale(2450);
      cloud.billboardMode = Mesh.BILLBOARDMODE_ALL;
      cloud.infiniteDistance = true;
      cloud.applyFog = false;
      cloud.isPickable = false;
    }
  }

  private buildTree(
    random: () => number,
    x: number,
    z: number,
    trunkParts: Mesh[],
    leafParts: Mesh[],
  ): void {
    const scale = 0.8 + random() * 0.55;
    const trunk = MeshBuilder.CreateCylinder(
      `tree-trunk-${x}-${z}`,
      { height: 4.6 * scale, diameterTop: 0.62, diameterBottom: 1.15, tessellation: 7 },
      this.scene,
    );
    trunk.position.set(x, BLOCK_TOP + 2.3 * scale, z);
    trunk.bakeCurrentTransformIntoVertices();
    trunkParts.push(trunk);

    const clusters = 2 + Math.floor(random() * 2);
    for (let i = 0; i < clusters; i += 1) {
      const crown = MeshBuilder.CreateSphere(
        `tree-crown-${x}-${z}-${i}`,
        { diameter: (3.6 + random() * 2.6) * scale, segments: 6 },
        this.scene,
      );
      crown.position.set(
        x + (random() - 0.5) * 2.4 * scale,
        BLOCK_TOP + (4.6 + random() * 1.8) * scale,
        z + (random() - 0.5) * 2.4 * scale,
      );
      crown.scaling.y = 0.82 + random() * 0.3;
      crown.bakeCurrentTransformIntoVertices();
      leafParts.push(crown);
    }
  }

  private buildStreetlights(
    gx: number,
    gz: number,
    centerX: number,
    centerZ: number,
    steelParts: Mesh[],
  ): void {
    // Two lamps per block on alternating sides keeps density believable
    // without exploding the merge cost.
    const sides: Array<[number, number]> =
      (gx + gz) % 2 === 0
        ? [
            [1, 0],
            [-1, 0],
          ]
        : [
            [0, 1],
            [0, -1],
          ];

    for (const [dx, dz] of sides) {
      const x = centerX + dx * 53.5;
      const z = centerZ + dz * 53.5;

      const pole = MeshBuilder.CreateCylinder(
        `lamp-pole-${gx}-${gz}-${dx}-${dz}`,
        { height: 9, diameter: 0.3, tessellation: 6 },
        this.scene,
      );
      pole.position.set(x, BLOCK_TOP + 4.5, z);
      pole.bakeCurrentTransformIntoVertices();
      steelParts.push(pole);

      const arm = MeshBuilder.CreateBox(
        `lamp-arm-${gx}-${gz}-${dx}-${dz}`,
        { width: 0.14, height: 0.14, depth: 2.4 },
        this.scene,
      );
      arm.position.set(x + dx * 1.1, BLOCK_TOP + 8.85, z + dz * 1.1);
      arm.rotation.y = Math.atan2(dx, dz);
      arm.bakeCurrentTransformIntoVertices();
      steelParts.push(arm);

      const head = MeshBuilder.CreateBox(
        `lamp-head-${gx}-${gz}-${dx}-${dz}`,
        { width: 0.42, height: 0.16, depth: 0.9 },
        this.scene,
      );
      head.position.set(x + dx * 2.3, BLOCK_TOP + 8.72, z + dz * 2.3);
      head.rotation.y = Math.atan2(dx, dz);
      head.bakeCurrentTransformIntoVertices();
      steelParts.push(head);
    }
  }

  private buildParkedCars(
    random: () => number,
    centerX: number,
    centerZ: number,
    paintParts: Mesh[][],
    glassParts: Mesh[],
    darkParts: Mesh[],
  ): void {
    const sides: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (const [dx, dz] of sides) {
      for (const slot of [-34, 0, 34]) {
        if (random() > 0.32) continue;

        const along = slot + (random() - 0.5) * 14;
        const x = centerX + dx * 58.2 + (dx === 0 ? along : 0);
        const z = centerZ + dz * 58.2 + (dz === 0 ? along : 0);
        const alongX = dx === 0; // car length runs along the road direction
        const length = 4.3 + random() * 0.7;
        const width = 1.9;
        const paintIndex = Math.floor(random() * paintParts.length);
        const parts = paintParts[paintIndex] ?? paintParts[0]!;

        const body = MeshBuilder.CreateBox(
          `car-body-${x}-${z}`,
          {
            width: alongX ? length : width,
            depth: alongX ? width : length,
            height: 0.55,
          },
          this.scene,
        );
        body.position.set(x, GROUND_Y + 0.78, z);
        body.bakeCurrentTransformIntoVertices();
        parts.push(body);

        const cabin = MeshBuilder.CreateBox(
          `car-cabin-${x}-${z}`,
          {
            width: alongX ? length * 0.52 : width * 0.9,
            depth: alongX ? width * 0.9 : length * 0.52,
            height: 0.52,
          },
          this.scene,
        );
        cabin.position.set(
          x - (alongX ? length * 0.06 : 0),
          GROUND_Y + 1.3,
          z - (alongX ? 0 : length * 0.06),
        );
        cabin.bakeCurrentTransformIntoVertices();
        glassParts.push(cabin);

        const under = MeshBuilder.CreateBox(
          `car-under-${x}-${z}`,
          {
            width: alongX ? length * 0.94 : width * 0.92,
            depth: alongX ? width * 0.92 : length * 0.94,
            height: 0.5,
          },
          this.scene,
        );
        under.position.set(x, GROUND_Y + 0.25, z);
        under.bakeCurrentTransformIntoVertices();
        darkParts.push(under);
      }
    }
  }

  private buildSpire(
    centerX: number,
    centerZ: number,
    concreteMaterial: StandardMaterial,
    steelMaterial: StandardMaterial,
  ): void {
    const base = MeshBuilder.CreateCylinder(
      "spire-base",
      { height: 5, diameterBottom: 16, diameterTop: 11, tessellation: 24 },
      this.scene,
    );
    base.position.set(centerX, BLOCK_TOP + 2.5, centerZ);
    base.material = concreteMaterial;
    base.receiveShadows = true;
    base.freezeWorldMatrix();
    this.shadows?.addShadowCaster(base);

    const shaft = MeshBuilder.CreateCylinder(
      "spire-shaft",
      { height: 74, diameterBottom: 5.5, diameterTop: 1.6, tessellation: 18 },
      this.scene,
    );
    shaft.position.set(centerX, BLOCK_TOP + 42, centerZ);
    shaft.material = steelMaterial;
    shaft.freezeWorldMatrix();
    this.shadows?.addShadowCaster(shaft);

    const deck = MeshBuilder.CreateCylinder(
      "spire-deck",
      { height: 2.4, diameter: 9, tessellation: 20 },
      this.scene,
    );
    deck.position.set(centerX, BLOCK_TOP + 62, centerZ);
    deck.material = concreteMaterial;
    deck.freezeWorldMatrix();
    this.shadows?.addShadowCaster(deck);

    const antenna = MeshBuilder.CreateCylinder(
      "spire-antenna",
      { height: 22, diameterBottom: 0.5, diameterTop: 0.1, tessellation: 6 },
      this.scene,
    );
    antenna.position.set(centerX, BLOCK_TOP + 90, centerZ);
    antenna.material = steelMaterial;
    antenna.freezeWorldMatrix();

    const beaconMaterial = new StandardMaterial("spire-beacon", this.scene);
    beaconMaterial.emissiveColor = Color3.FromHexString("#ff4338");
    beaconMaterial.disableLighting = true;
    const beacon = MeshBuilder.CreateSphere("spire-beacon", { diameter: 0.9, segments: 8 }, this.scene);
    beacon.position.set(centerX, BLOCK_TOP + 101.5, centerZ);
    beacon.material = beaconMaterial;
    beacon.freezeWorldMatrix();

    this.colliders.push({
      minX: centerX - 8,
      maxX: centerX + 8,
      minZ: centerZ - 8,
      maxZ: centerZ + 8,
    });
  }
}

/** Per-face UV repeats so windows keep real-world scale on any box size. */
function facadeUv(width: number, depth: number, height: number): Vector4[] {
  const w = width / FACADE_TILE_METERS;
  const d = depth / FACADE_TILE_METERS;
  const h = height / FACADE_TILE_METERS;
  const front = new Vector4(0, 0, w, h);
  const side = new Vector4(0, 0, d, h);
  const roof = new Vector4(0.005, 0.005, 0.035, 0.035);
  return [front, front, side, side, roof, roof];
}

function plainUv(): Vector4[] {
  const roof = new Vector4(0.005, 0.005, 0.035, 0.035);
  return [roof, roof, roof, roof, roof, roof];
}

function mergeGroup(name: string, meshes: Mesh[], groupMaterial: StandardMaterial): Mesh | null {
  if (meshes.length === 0) return null;
  const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
  if (merged) {
    merged.name = name;
    merged.material = groupMaterial;
    merged.freezeWorldMatrix();
  }
  return merged;
}

function texturedMaterial(scene: Scene, name: string, texture: Texture): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseTexture = texture;
  result.specularColor = Color3.Black();
  return result;
}

function flatMaterial(scene: Scene, name: string, diffuse: string): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = Color3.FromHexString(diffuse);
  result.specularColor = new Color3(0.05, 0.05, 0.05);
  result.specularPower = 32;
  return result;
}

function snapRoad(value: number): number {
  return (Math.round(value / BLOCK_PITCH - 0.5) + 0.5) * BLOCK_PITCH;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
