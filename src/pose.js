export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const AIR_TUCK_KNEE = 2.5;
export const AIR_TUCK_HIP = 2.55;

export const bodyParts = {
  foot: { w: .40, h: .08, d: 90 },
  shin: { w: .10, h: .42, d: 90 },
  thigh: { w: .13, h: .45, d: 90 },
  torso: { w: .26, h: .60, d: 90 },
  uarm: { w: .08, h: .30, d: 90 },
  farm: { w: .07, h: .30, d: 90 },
  head: { radius: .12, d: 90 },
};

export const jointLayout = [
  { id: 'ankle', a: 'foot', b: 'shin', height: .08, min: -1, max: 1.65, torque: 800, speed: 8 },
  { id: 'knee', a: 'shin', b: 'thigh', height: .5, min: 0, max: 2.95, torque: 1800, speed: 16 },
  { id: 'hip', a: 'thigh', b: 'torso', height: .95, min: -3.1, max: 1.5, torque: 1500, speed: 14 },
  { id: 'neck', a: 'torso', b: 'head', height: 1.55, min: -.6, max: .6, torque: 120, speed: 5 },
  { id: 'sh', a: 'torso', b: 'uarm', height: 1.5, min: -1.5, max: 3.3, torque: 160, speed: 12 },
  { id: 'el', a: 'uarm', b: 'farm', height: 1.2, min: -.1, max: 1.8, torque: 60, speed: 6 },
];

export function postureTargets(mouse, airborne = false, tuckAmount = 100) {
  // The upper part of the control area is a fully extended pose, even at a side.
  const inputCrouch = airborne ? clamp((.65 - mouse.y) / 1.65, 0, 1) : (1 - mouse.y) / 2;
  const amount = inputCrouch * (airborne ? clamp(tuckAmount, 0, 150) / 100 : 1);
  const crouch = clamp(amount, 0, 1);
  const extraTuck = clamp((amount - 1) * 2, 0, 1);
  const extension = 1 - crouch;
  if (airborne) {
    const leanBlend = 4 * crouch * extension * (1 - extraTuck);
    const backArch = .12 * clamp((mouse.y - .85) / .15, 0, 1);
    return {
      ankle: Math.PI / 2 * extension - .7 * crouch - .25 * extraTuck,
      knee: AIR_TUCK_KNEE * crouch + .4 * extraTuck,
      hip: -AIR_TUCK_HIP * crouch - .45 * extraTuck - .6 * mouse.x * leanBlend + backArch,
      neck: -.15 * mouse.x * leanBlend - .25 * crouch - .1 * extraTuck,
      // Reach down toward the folded shins beside the pelvis, rather than
      // bending the elbows so far that the hands stay up by the chest.
      sh: .12 * crouch + Math.PI * extension + .4 * mouse.x * leanBlend - .15 * extraTuck,
      el: .75 * crouch + .2 * extraTuck,
    };
  }
  return {
    ankle: -.45 * crouch - .25 * mouse.x,
    knee: 1.5 * crouch,
    hip: -1.4 * crouch - 1.4 * mouse.x,
    neck: -.15 * mouse.x,
    sh: -.4 + 3.5 * extension + .8 * mouse.x,
    el: .15 + .5 * crouch,
  };
}
