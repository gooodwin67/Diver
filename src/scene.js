import * as THREE from 'three';
import { cliffOutline } from './levels.js';
import { bodyParts } from './pose.js';

export class DiveScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0xdddddd);
    container.insertBefore(this.renderer.domElement, container.firstChild);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.black = this.material(0x000000);
    this.view = { cx: 6, cy: 6, h: 20 };
    this.group = null;
    this.meshes = [];

    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#7c93ab');
    gradient.addColorStop(.12, '#5a748e');
    gradient.addColorStop(.6, '#1d2c3b');
    gradient.addColorStop(1, '#05080c');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 256);
    this.waterTexture = new THREE.CanvasTexture(canvas);
    this.waterTexture.colorSpace = THREE.SRGBColorSpace;
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(200, 60), new THREE.MeshBasicMaterial({
      map: this.waterTexture, transparent: true, opacity: .88,
    }));
    this.water.position.set(6, -30, 3);
    this.scene.add(this.water);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener('resize', () => this.resize());
  }

  material(color, opacity) {
    return new THREE.MeshBasicMaterial({ color, transparent: opacity !== undefined, opacity: opacity ?? 1 });
  }

  polygon(points, material, z) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
    mesh.position.z = z;
    this.group.add(mesh);
  }

  loadLevel(level, physics) {
    if (this.group) {
      const materials = new Set();
      this.group.traverse(object => {
        object.geometry?.dispose();
        if (object.material && object.material !== this.black) materials.add(object.material);
      });
      materials.forEach(material => material.dispose());
      this.scene.remove(this.group);
    }
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.meshes = [];
    const H = level.H;
    const middle = (level.b[0] + level.b[1]) / 2;
    this.view = { cx: 4 + middle * .35, cy: (H - 4) / 2, h: H + 12 };
    this.resize();

    const sun = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), this.material(0xffffff));
    sun.position.set(this.view.cx + 9, H + 1, -5);
    this.group.add(sun);
    this.polygon([[11, -30], [11, H * .85], [13, H * .9], [17, H * .88], [22, H * .8], [60, H * .78], [60, -30]], this.material(0xb4b4b4), -4);
    this.polygon([[-30, -30], [-30, H * .55], [-10, H * .62], [2, H * .45], [6, H * .35], [10, H * .2], [10, -30]], this.material(0xcdcdcd), -4.5);
    this.polygon([[6, -30], [7, H * .35], [8.5, H * .5], [9.5, H * .3], [10.5, -30]], this.material(0xc2c2c2), -3.8);
    this.polygon(cliffOutline(level), this.black, 0);

    for (const x of level.b) {
      const buoy = new THREE.Mesh(new THREE.CircleGeometry(.38, 24), this.material(0xe0452a));
      buoy.position.set(x, .05, 1.5);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(.04, 9), this.black);
      line.position.set(x, -4.5, 1.4);
      this.group.add(line, buoy);
    }
    for (const [id, body] of Object.entries(physics.bodies)) {
      const part = bodyParts[id];
      const geometry = part.radius ? new THREE.CircleGeometry(part.radius, 20) : new THREE.PlaneGeometry(part.w, part.h);
      const mesh = new THREE.Mesh(geometry, this.black);
      mesh.position.z = 1;
      this.group.add(mesh);
      this.meshes.push([body, mesh]);
    }
  }

  resize() {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    let viewHeight = this.view.h, viewWidth = viewHeight * aspect;
    if (viewWidth < 26) { viewWidth = 26; viewHeight = viewWidth / aspect; }
    this.camera.left = this.view.cx - viewWidth / 2;
    this.camera.right = this.view.cx + viewWidth / 2;
    this.camera.top = this.view.cy + viewHeight / 2;
    this.camera.bottom = this.view.cy - viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }

  render() {
    for (const [body, mesh] of this.meshes) {
      const position = body.getPosition();
      mesh.position.x = position.x;
      mesh.position.y = position.y;
      mesh.rotation.z = body.getAngle();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
