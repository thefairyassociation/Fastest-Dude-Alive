import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

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

  constructor(readonly scene: Scene) {
    this.build();
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
    scene.clearColor = new Color4(0.035, 0.04, 0.085, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.055, 0.065, 0.13);
    scene.fogDensity = 0.00034;

    const skyLight = new HemisphericLight("sky-light", new Vector3(0.2, 1, -0.1), scene);
    skyLight.intensity = 1.25;
    skyLight.diffuse = new Color3(0.52, 0.6, 1);
    skyLight.groundColor = new Color3(0.08, 0.04, 0.13);

    const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.25), scene);
    sun.position = new Vector3(600, 900, -400);
    sun.intensity = 1.7;
    sun.diffuse = new Color3(1, 0.78, 0.58);

    const asphalt = material(scene, "asphalt", "#111525", "#080b14");
    asphalt.specularColor = new Color3(0.12, 0.14, 0.2);
    const ground = MeshBuilder.CreateGround(
      "city-ground",
      { width: this.extent * 2 + 500, height: this.extent * 2 + 500, subdivisions: 1 },
      scene,
    );
    ground.position.y = -0.18;
    ground.material = asphalt;
    ground.freezeWorldMatrix();

    const sidewalkMaterial = material(scene, "sidewalk", "#303347", "#111324");
    const grassMaterial = material(scene, "park-grass", "#173e38", "#0b1c1b");
    const trunkMaterial = material(scene, "tree-trunk", "#3d2b32", "#160f13");
    const leafMaterial = material(scene, "tree-leaf", "#2a7b68", "#0c2d29");
    const buildingMaterials = [
      material(scene, "tower-violet", "#3f3a66", "#17142c"),
      material(scene, "tower-blue", "#294d64", "#0e1d2b"),
      material(scene, "tower-warm", "#5d454d", "#28171d"),
      material(scene, "tower-slate", "#3f4858", "#171d27"),
    ];
    for (const towerMaterial of buildingMaterials) {
      towerMaterial.specularColor = new Color3(0.25, 0.3, 0.42);
    }

    const random = mulberry32(0xfda2026);
    const sidewalks: Mesh[] = [];
    const buildingGroups: Mesh[][] = buildingMaterials.map(() => []);
    const parkParts: Mesh[] = [];

    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx += 1) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz += 1) {
        const centerX = gx * BLOCK_PITCH;
        const centerZ = gz * BLOCK_PITCH;
        const isPark = random() < 0.075 && Math.abs(gx) + Math.abs(gz) > 2;

        const block = MeshBuilder.CreateBox(
          `block-${gx}-${gz}`,
          { width: BLOCK_SIZE, depth: BLOCK_SIZE, height: 0.5 },
          scene,
        );
        block.position.set(centerX, 0.08, centerZ);
        block.material = isPark ? grassMaterial : sidewalkMaterial;
        block.bakeCurrentTransformIntoVertices();
        (isPark ? parkParts : sidewalks).push(block);

        if (isPark) {
          for (let tree = 0; tree < 7; tree += 1) {
            const x = centerX + (random() - 0.5) * 78;
            const z = centerZ + (random() - 0.5) * 78;
            const trunk = MeshBuilder.CreateCylinder(
              `tree-trunk-${gx}-${gz}-${tree}`,
              { height: 4, diameter: 1.2, tessellation: 7 },
              scene,
            );
            trunk.position.set(x, 2, z);
            trunk.material = trunkMaterial;
            trunk.bakeCurrentTransformIntoVertices();
            parkParts.push(trunk);

            const crown = MeshBuilder.CreateSphere(
              `tree-crown-${gx}-${gz}-${tree}`,
              { diameter: 5 + random() * 3, segments: 6 },
              scene,
            );
            crown.position.set(x, 5.2, z);
            crown.scaling.y = 1.25;
            crown.material = leafMaterial;
            crown.bakeCurrentTransformIntoVertices();
            parkParts.push(crown);
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
            const tower = MeshBuilder.CreateBox(
              `tower-${gx}-${gz}-${ox}-${oz}`,
              { width, depth, height },
              scene,
            );
            tower.position.set(x, height * 0.5 + 0.32, z);
            tower.material = buildingMaterials[group] ?? buildingMaterials[0]!;
            tower.bakeCurrentTransformIntoVertices();
            buildingGroups[group]?.push(tower);
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

    mergeGroup("sidewalks", sidewalks, sidewalkMaterial);
    mergeGroup("parks", parkParts, grassMaterial);
    buildingGroups.forEach((group, index) => {
      mergeGroup(`building-group-${index}`, group, buildingMaterials[index] ?? buildingMaterials[0]!);
    });

    const laneMaterial = material(scene, "lane-light", "#7befff", "#46dbe8");
    laneMaterial.alpha = 0.5;
    for (let i = -GRID_RADIUS; i <= GRID_RADIUS + 1; i += 1) {
      const road = (i - 0.5) * BLOCK_PITCH;
      const vertical = MeshBuilder.CreateBox(
        `lane-v-${i}`,
        { width: 0.35, depth: this.extent * 2, height: 0.025 },
        scene,
      );
      vertical.position.set(road, -0.02, 0);
      vertical.material = laneMaterial;
      vertical.freezeWorldMatrix();

      const horizontal = MeshBuilder.CreateBox(
        `lane-h-${i}`,
        { width: this.extent * 2, depth: 0.35, height: 0.025 },
        scene,
      );
      horizontal.position.set(0, -0.015, road);
      horizontal.material = laneMaterial;
      horizontal.freezeWorldMatrix();
    }

    this.createLandmark();
  }

  private createLandmark(): void {
    const ringMaterial = material(this.scene, "landmark-energy", "#6ff4ff", "#41d9ff");
    const position = new Vector3(75, 0, 75);
    for (let i = 0; i < 5; i += 1) {
      const ring = MeshBuilder.CreateTorus(
        `landmark-ring-${i}`,
        { diameter: 18 + i * 7, thickness: 0.28, tessellation: 48 },
        this.scene,
      );
      ring.position.copyFrom(position);
      ring.position.y = 18 + i * 11;
      ring.rotation.x = Math.PI * 0.5;
      ring.rotation.z = i * 0.34;
      ring.material = ringMaterial;
    }
  }
}

function mergeGroup(name: string, meshes: Mesh[], groupMaterial: StandardMaterial): void {
  if (meshes.length === 0) return;
  const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
  if (merged) {
    merged.name = name;
    merged.material = groupMaterial;
    merged.freezeWorldMatrix();
  }
}

function material(scene: Scene, name: string, diffuse: string, emissive: string): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = Color3.FromHexString(diffuse);
  result.emissiveColor = Color3.FromHexString(emissive);
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
