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
  health = 4;
  alive = true;
  respawnTimer = 0;
  attackCooldown = 1 + Math.random();
  readonly velocity = Vector3.Zero();

  private readonly core: Mesh;
  private readonly rings: Mesh[] = [];
  private age = Math.random() * 10;

  constructor(
    scene: Scene,
    readonly id: number,
    readonly spawn: Vector3,
  ) {
    this.root = new TransformNode(`pursuit-drone-${id}`, scene);
    this.root.position.copyFrom(spawn);

    const shell = new StandardMaterial(`drone-shell-${id}`, scene);
    shell.diffuseColor = Color3.FromHexString("#23263d");
    shell.emissiveColor = Color3.FromHexString("#111326");
    shell.specularColor = new Color3(0.7, 0.4, 0.9);

    const energy = new StandardMaterial(`drone-energy-${id}`, scene);
    energy.diffuseColor = Color3.FromHexString("#ff4f8b");
    energy.emissiveColor = Color3.FromHexString("#ff1f6d");
    energy.disableLighting = true;

    this.core = MeshBuilder.CreatePolyhedron(
      `drone-core-${id}`,
      { type: 1, size: 1.45 },
      scene,
    );
    this.core.material = shell;
    this.core.parent = this.root;

    for (let i = 0; i < 2; i += 1) {
      const ring = MeshBuilder.CreateTorus(
        `drone-ring-${id}-${i}`,
        { diameter: 3.2 + i * 0.65, thickness: 0.12, tessellation: 24 },
        scene,
      );
      ring.rotation.x = i === 0 ? Math.PI * 0.5 : 0;
      ring.material = energy;
      ring.parent = this.root;
      this.rings.push(ring);
    }

    const eye = MeshBuilder.CreateSphere(
      `drone-eye-${id}`,
      { diameter: 0.42, segments: 8 },
      scene,
    );
    eye.position.z = 1.25;
    eye.material = energy;
    eye.parent = this.root;
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
    if (this.velocity.lengthSquared() > 0.1) {
      this.root.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
    }

    this.core.rotation.y += dt * 1.7;
    this.rings.forEach((ring, index) => {
      ring.rotation.z += dt * (index === 0 ? 2.8 : -2.2);
      ring.scaling.setAll(1 + Math.sin(this.age * 5 + index) * 0.035);
    });

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
    this.core.scaling.setAll(1.25);

    if (this.health <= 0) {
      this.alive = false;
      this.respawnTimer = 7 + Math.random() * 5;
      this.root.setEnabled(false);
      return true;
    }

    window.setTimeout(() => {
      if (this.alive) this.core.scaling.setAll(1);
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
