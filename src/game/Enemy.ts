import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

export class Enemy {
  readonly root: TransformNode;
  /** Hull-only CSM proxy — rotors/nav lights stay out of the shadow map. */
  readonly shadowCaster: Mesh;
  health = 4;
  alive = true;
  respawnTimer = 0;
  attackCooldown = 1 + Math.random();
  readonly velocity = Vector3.Zero();

  private readonly hull: Mesh;
  private readonly rotors: Mesh[] = [];
  private age = Math.random() * 10;

  constructor(
    scene: Scene,
    readonly id: number,
    readonly spawn: Vector3,
  ) {
    this.root = new TransformNode(`pursuit-drone-${id}`, scene);
    this.root.position.copyFrom(spawn);

    const gunmetal = new StandardMaterial(`drone-gunmetal-${id}`, scene);
    gunmetal.diffuseColor = Color3.FromHexString("#4c5157");
    gunmetal.specularColor = new Color3(0.4, 0.42, 0.45);
    gunmetal.specularPower = 48;

    const dark = new StandardMaterial(`drone-dark-${id}`, scene);
    dark.diffuseColor = Color3.FromHexString("#22262a");
    dark.specularColor = new Color3(0.2, 0.2, 0.22);

    const rotorBlur = new StandardMaterial(`drone-rotor-${id}`, scene);
    rotorBlur.diffuseColor = Color3.FromHexString("#2d3033");
    rotorBlur.specularColor = Color3.Black();
    rotorBlur.alpha = 0.34;
    rotorBlur.backFaceCulling = false;

    const navRed = new StandardMaterial(`drone-nav-red-${id}`, scene);
    navRed.emissiveColor = Color3.FromHexString("#ff3b30");
    navRed.disableLighting = true;

    const navGreen = new StandardMaterial(`drone-nav-green-${id}`, scene);
    navGreen.emissiveColor = Color3.FromHexString("#30d158");
    navGreen.disableLighting = true;

    const add = (mesh: Mesh, material: StandardMaterial): Mesh => {
      mesh.material = material;
      mesh.parent = this.root;
      return mesh;
    };

    this.hull = MeshBuilder.CreateSphere(`drone-hull-${id}`, { diameter: 1.9, segments: 12 }, scene);
    this.hull.scaling.set(1, 0.5, 1.15);
    add(this.hull, gunmetal);
    this.shadowCaster = this.hull;

    const belly = MeshBuilder.CreateCylinder(
      `drone-belly-${id}`,
      { height: 0.5, diameterTop: 0.85, diameterBottom: 0.55, tessellation: 10 },
      scene,
    );
    belly.position.y = -0.5;
    add(belly, dark);

    const lens = MeshBuilder.CreateSphere(`drone-lens-${id}`, { diameter: 0.34, segments: 8 }, scene);
    lens.position.set(0, -0.18, 0.92);
    add(lens, dark);

    // Four rotor booms with translucent spinning discs.
    const armOffsets: Array<[number, number]> = [
      [0.92, 0.92],
      [-0.92, 0.92],
      [0.92, -0.92],
      [-0.92, -0.92],
    ];
    for (let i = 0; i < armOffsets.length; i += 1) {
      const offset = armOffsets[i];
      if (!offset) continue;
      const [ax, az] = offset;

      const arm = MeshBuilder.CreateBox(
        `drone-arm-${id}-${i}`,
        { width: 0.16, height: 0.09, depth: 1.34 },
        scene,
      );
      arm.position.set(ax * 0.5, 0.08, az * 0.5);
      arm.rotation.y = Math.atan2(ax, az);
      add(arm, gunmetal);

      const hub = MeshBuilder.CreateCylinder(
        `drone-hub-${id}-${i}`,
        { height: 0.2, diameter: 0.24, tessellation: 8 },
        scene,
      );
      hub.position.set(ax, 0.18, az);
      add(hub, dark);

      const rotor = MeshBuilder.CreateCylinder(
        `drone-rotor-${id}-${i}`,
        { height: 0.03, diameter: 1.18, tessellation: 18 },
        scene,
      );
      rotor.position.set(ax, 0.3, az);
      add(rotor, rotorBlur);
      this.rotors.push(rotor);

      // Aviation nav lights: red portside, green starboard.
      const light = MeshBuilder.CreateSphere(
        `drone-nav-${id}-${i}`,
        { diameter: 0.1, segments: 6 },
        scene,
      );
      light.position.set(ax * 1.16, 0.1, az * 1.16);
      add(light, ax < 0 ? navRed : navGreen);
    }
  }

  get position(): Vector3 {
    return this.root.position;
  }

  update(dt: number, playerPosition: Vector3): number {
    if (!this.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
      return 0;
    }

    this.age += dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const toPlayer = playerPosition.subtract(this.root.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();

    if (distance < 300 && distance > 0.01) {
      const direction = toPlayer.scale(1 / distance);
      const orbit = new Vector3(direction.z, 0, -direction.x);
      const desired = distance > 24
        ? direction.scale(distance > 100 ? 48 : 28)
        : orbit.scale(19).addInPlace(direction.scale(-6));
      Vector3.LerpToRef(this.velocity, desired, 1 - Math.exp(-2.8 * dt), this.velocity);
    } else {
      this.velocity.scaleInPlace(Math.exp(-2 * dt));
    }

    this.root.position.addInPlace(this.velocity.scale(dt));
    this.root.position.y = this.spawn.y + Math.sin(this.age * 2.4 + this.id) * 0.7;
    const speed = this.velocity.length();
    if (speed * speed > 0.1) {
      this.root.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
    }

    // Quadcopters pitch into their direction of travel.
    this.root.rotation.x = Math.min(0.32, speed * 0.011);
    this.root.rotation.z = Math.sin(this.age * 1.7 + this.id) * 0.03;

    for (let i = 0; i < this.rotors.length; i += 1) {
      const rotor = this.rotors[i];
      if (!rotor) continue;
      rotor.rotation.y += dt * (i % 2 === 0 ? 46 : -46);
    }

    if (distance < 7.5 && this.attackCooldown <= 0) {
      this.attackCooldown = 1.35;
      return 12;
    }
    return 0;
  }

  hit(damage: number, impulse: Vector3): boolean {
    if (!this.alive) return false;
    this.health -= damage;
    this.velocity.addInPlace(impulse);
    this.hull.scaling.set(1.2, 0.6, 1.35);

    if (this.health <= 0) {
      this.alive = false;
      this.respawnTimer = 7 + Math.random() * 5;
      this.root.setEnabled(false);
      return true;
    }

    window.setTimeout(() => {
      if (this.alive) this.hull.scaling.set(1, 0.5, 1.15);
    }, 80);
    return false;
  }

  private respawn(): void {
    this.health = 4;
    this.alive = true;
    this.root.position.copyFrom(this.spawn);
    this.velocity.setAll(0);
    this.root.setEnabled(true);
  }
}
