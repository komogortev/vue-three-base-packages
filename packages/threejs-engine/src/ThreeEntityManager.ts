import * as THREE from 'three'
import type { EntityManager, EventBus } from '@base/engine-core'

interface Vec3 {
  x: number
  y: number
  z: number
}

interface EntityRecord {
  components: Record<string, unknown>
  mesh?: THREE.Object3D
  state?: string
}

/**
 * Three.js-aware implementation of EntityManager.
 *
 * Entities are identified by a stable string ID. Each entity can hold:
 * - Arbitrary component data (key/value pairs)
 * - One root Three.js Object3D (mesh, group, etc.) whose lifecycle is managed
 * - A state label that, when changed, emits `entity:state-change` on the event bus
 *
 * When an entity is destroyed, its mesh is removed from the scene and GPU
 * resources (geometry, materials, textures) are disposed automatically.
 *
 * For objects that do not need ECS identity (lights, skyboxes, debug helpers),
 * use ctx.scene.add() directly — this manager does not restrict scene access.
 */
export class ThreeEntityManager implements EntityManager {
  private entities = new Map<string, EntityRecord>()

  constructor(
    private readonly scene: THREE.Scene,
    private readonly eventBus: EventBus,
  ) {}

  // ─── EntityManager interface ─────────────────────────────────────────────────

  create(id: string, components: Record<string, unknown> = {}): string {
    if (this.entities.has(id)) {
      console.warn(`[ThreeEntityManager] Entity '${id}' already exists — skipping create`)
      return id
    }
    this.entities.set(id, { components: { ...components } })
    return id
  }

  destroy(id: string): void {
    const record = this.entities.get(id)
    if (!record) return

    if (record.mesh) {
      this.scene.remove(record.mesh)
      this.disposeObject(record.mesh)
    }

    this.entities.delete(id)
  }

  get(id: string): Record<string, unknown> | undefined {
    return this.entities.get(id)?.components
  }

  query(componentKeys: string[]): string[] {
    const result: string[] = []
    for (const [id, record] of this.entities) {
      if (componentKeys.every((k) => k in record.components)) {
        result.push(id)
      }
    }
    return result
  }

  // ─── Extended API ────────────────────────────────────────────────────────────

  /** Set an arbitrary component value on an existing entity. */
  set(id: string, key: string, value: unknown): void {
    const record = this.entities.get(id)
    if (!record) {
      console.warn(`[ThreeEntityManager] set() called on unknown entity '${id}'`)
      return
    }
    record.components[key] = value
  }

  /**
   * Attach a Three.js object to an entity and add it to the scene.
   * Throws if the entity does not exist. An entity can only have one root mesh —
   * use a THREE.Group to attach multiple objects.
   */
  addMesh(id: string, mesh: THREE.Object3D): void {
    const record = this.entities.get(id)
    if (!record) throw new Error(`[ThreeEntityManager] addMesh() — entity '${id}' does not exist`)
    if (record.mesh) {
      console.warn(`[ThreeEntityManager] Entity '${id}' already has a mesh — replacing`)
      this.scene.remove(record.mesh)
      this.disposeObject(record.mesh)
    }
    record.mesh = mesh
    this.scene.add(mesh)
  }

  /** Retrieve the root Three.js object attached to an entity. */
  getMesh(id: string): THREE.Object3D | undefined {
    return this.entities.get(id)?.mesh
  }

  /**
   * Sync position, rotation (Euler XYZ radians), and scale to the entity's mesh.
   * Any undefined argument is left unchanged.
   */
  setTransform(id: string, position?: Vec3, rotation?: Vec3, scale?: Vec3): void {
    const mesh = this.entities.get(id)?.mesh
    if (!mesh) return

    if (position !== undefined) mesh.position.set(position.x, position.y, position.z)
    if (rotation !== undefined) mesh.rotation.set(rotation.x, rotation.y, rotation.z)
    if (scale !== undefined) mesh.scale.set(scale.x, scale.y, scale.z)
  }

  /**
   * Update the entity's state label and emit `entity:state-change` on the event bus.
   * Does not interpret what states mean — that is the responsibility of child modules
   * (e.g. an animation controller listening for 'entity:state-change').
   *
   * Event payload: `{ id: string, from: string | undefined, to: string }`
   */
  setState(id: string, state: string): void {
    const record = this.entities.get(id)
    if (!record) {
      console.warn(`[ThreeEntityManager] setState() called on unknown entity '${id}'`)
      return
    }
    const from = record.state
    record.state = state
    this.eventBus.emit('entity:state-change', { id, from, to: state })
  }

  /** Read the current state label of an entity. */
  getState(id: string): string | undefined {
    return this.entities.get(id)?.state
  }

  /** Destroy all entities. Called by ThreeModule.onUnmount(). */
  destroyAll(): void {
    for (const id of [...this.entities.keys()]) {
      this.destroy(id)
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return

      child.geometry?.dispose()

      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const mat of materials) {
        this.disposeMaterial(mat)
      }
    })
  }

  private disposeMaterial(mat: THREE.Material): void {
    for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) value.dispose()
    }
    mat.dispose()
  }
}
