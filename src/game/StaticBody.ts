import * as CANNON from 'cannon-es';

/**
 * Build a static physics body that the broadphase can actually find.
 *
 * There is one trap here and it is expensive. Passing `shape` to the `Body`
 * constructor computes the body's AABB straight away — at the origin, because
 * the body has not been positioned yet — and clears `aabbNeedsUpdate`.
 * Nothing sets that flag again: only `integrate()` re-flags a body as it
 * moves, and a static body never integrates. So the AABB stays at the origin
 * for the lifetime of the world.
 *
 * Every broadphase query is gated on that AABB — contacts *and* raycasts —
 * so the body is silently invisible everywhere except at 0,0,0. It looks
 * perfectly correct in the scene, has the right shape and the right
 * transform, and simply never collides.
 *
 * Recomputing the AABB after positioning is the whole fix, and it costs one
 * call per body at load time.
 */
export function staticBody(options: {
  shape: CANNON.Shape;
  position: { x: number; y: number; z: number };
  quaternion?: CANNON.Quaternion;
  material?: CANNON.Material;
}): CANNON.Body {
  const body = new CANNON.Body({
    mass: 0,
    shape: options.shape,
    material: options.material,
  });

  body.position.set(options.position.x, options.position.y, options.position.z);
  if (options.quaternion) body.quaternion.copy(options.quaternion);

  body.updateAABB();
  return body;
}
