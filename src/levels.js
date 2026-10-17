export const levels = [
  { H: 10, b: [5.5, 8], bump: null },
  { H: 14, b: [7, 9.8], bump: null },
  { H: 18, b: [8, 10.5], bump: null },
  { H: 12, b: [6.5, 8.6], bump: [[2.4, .66], [3.6, .52], [.6, .44]] },
  { H: 22, b: [9, 10.9], bump: null },
  { H: 16, b: [6, 7.8], bump: [[3.2, .7], [4.4, .56], [.8, .46]] },
];

export function cliffOutline(level) {
  const face = [[1.4, level.H], [.9, level.H * .7]];
  if (level.bump) level.bump.forEach(([x, height]) => face.push([x, level.H * height]));
  face.push([.2, level.H * .4], [-.6, 0], [-1, -30]);
  return [[-40, -30], [-40, level.H], ...face];
}
