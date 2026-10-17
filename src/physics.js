import { World, Vec2, Box, Circle, Chain, RevoluteJoint } from 'planck';
import { cliffOutline } from './levels.js';
import { bodyParts, jointLayout, postureTargets, clamp, AIR_TUCK_KNEE, AIR_TUCK_HIP } from './pose.js';

const V = (x, y) => new Vec2(x, y);
const normalizeAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const LANDING_RECOVERY = .5;
const MIN_ABSORBED_JUMP_HEIGHT = .6;
const JUMP_POINTER_HEIGHT = .65;
const MIN_JUMP_POINTER_TRAVEL = .8;

export class DivePhysics {
  constructor(settings, onFinish) {
    this.settings = settings;
    this.onFinish = onFinish;
    this.mouse = { x: 0, y: 0 };
  }

  reset(level) {
    this.level = level;
    this.world = new World({ gravity: V(0, -this.settings.gravity) });
    this.limp = false;
    this.entered = false;
    this.done = false;
    this.score = null;
    this.entryInfo = '';
    this.elapsed = 0;
    this.footContacts = 0;
    this.jerk = 0;
    this.lastPointer = null;
    this.groundTimer = 40;
    this.balanceAdjustment = 0;
    this.lockStrength = 1;
    this.landing = false;
    this.landingTime = 0;
    this.landingTargets = null;
    this.jumpUntil = 0;
    this.jumpGestureLow = null;
    this.jumpStrength = 0;
    this.launchLean = 0;
    this.launchSpinLean = 0;
    this.jumpGestureStartX = 0;
    this.motorSpeeds = {};
    this.jumping = false;
    this.airTime = 0;
    this.landingNormal = null;
    this.takeoffHeight = null;
    this.jumpRise = 0;
    this.airSpinFactor = 1;
    this.airSpinPeakFactor = 1;
    this.straightAirTime = 0;

    const cliff = this.world.createBody({ type: 'static' });
    cliff.createFixture(new Chain(cliffOutline(level).map(([x, y]) => V(x, y)), true), {
      friction: .9, restitution: 0,
    });
    cliff.setUserData('cliff');

    const x = this.settings.startX, ground = level.H;
    const positions = {
      foot: [x + .06, ground + .04],
      shin: [x, ground + .08 + .21],
      thigh: [x, ground + .5 + .225],
      torso: [x, ground + .95 + .30],
      uarm: [x, ground + 1.5 - .15],
      farm: [x, ground + 1.2 - .15],
      head: [x, ground + 1.55 + .13],
    };
    this.bodies = {};
    for (const [id, [px, py]] of Object.entries(positions)) {
      const part = bodyParts[id];
      const body = this.world.createBody({ type: 'dynamic', position: V(px, py), bullet: true });
      const shape = part.radius ? new Circle(part.radius) : new Box(part.w / 2, part.h / 2);
      body.createFixture(shape, {
        density: part.d,
        friction: id === 'foot' ? 2.5 : id === 'head' ? .3 : .4,
        restitution: 0,
        filterGroupIndex: -1,
      });
      body.setUserData(id);
      this.bodies[id] = body;
    }

    this.joints = {};
    for (const def of jointLayout) {
      const joint = this.world.createJoint(new RevoluteJoint({
        lowerAngle: def.min, upperAngle: def.max, enableLimit: true,
        enableMotor: true, motorSpeed: 0, maxMotorTorque: def.torque,
      }, this.bodies[def.a], this.bodies[def.b], V(x, ground + def.height)));
      joint.vmax = def.speed;
      this.joints[def.id] = joint;
    }

    this.world.on('end-contact', contact => this.footTouch(contact, -1));
    this.world.on('begin-contact', contact => {
      this.footTouch(contact, 1);
      const a = contact.getFixtureA().getBody().getUserData();
      const b = contact.getFixtureB().getBody().getUserData();
      const part = a === 'cliff' ? b : b === 'cliff' ? a : null;
      if (['head', 'torso', 'uarm', 'farm'].includes(part)) this.goLimp();
    });
  }

  footTouch(contact, change) {
    const a = contact.getFixtureA().getBody().getUserData();
    const b = contact.getFixtureB().getBody().getUserData();
    if ((a === 'foot' && b === 'cliff') || (b === 'foot' && a === 'cliff')) {
      this.footContacts = Math.max(0, this.footContacts + change);
      if (change > 0 && (this.airTime > .04 || this.jumping)) {
        const manifold = contact.getWorldManifold(null);
        if (!manifold) return;
        const direction = a === 'cliff' ? 1 : -1;
        const normal = V(manifold.normal.x * direction, manifold.normal.y * direction);
        if (normal.y > .65) {
          this.landing = true;
          this.landingNormal = normal;
        }
      }
    }
  }

  goLimp() {
    if (this.limp) return;
    this.limp = true;
    for (const joint of Object.values(this.joints)) joint.enableMotor(false);
    if (!this.entered) this.score = 0;
  }

  setPointer(clientX, clientY, bounds) {
    let x = (clientX - (bounds.left + bounds.width / 2)) / (Math.min(bounds.width, bounds.height * 1.4) * .36);
    let y = -(clientY - (bounds.top + bounds.height / 2)) / (bounds.height * .36);
    const pointerHeight = clamp(y, -1, 1);
    // Horizontal lean must not reduce the vertical reach of the pose control.
    x = clamp(x, -1, 1);
    y = clamp(y, -1, 1);
    const now = performance.now();
    const supported = this.groundTimer > 0 && !this.jumping && !this.limp && !this.entered;
    if (supported) {
      // Remember the lean in the crouch, independently of the upward stroke.
      if (this.jumpGestureLow === null || pointerHeight <= this.jumpGestureLow + .03) {
        this.jumpGestureStartX = x;
      }
      this.jumpGestureLow = Math.min(this.jumpGestureLow ?? pointerHeight, pointerHeight);
    } else {
      this.jumpGestureLow = null;
    }
    if (this.lastPointer) {
      const seconds = Math.max(4, now - this.lastPointer.time) / 1000;
      const speed = Math.hypot(x - this.lastPointer.x, y - this.lastPointer.y)
        / seconds;
      this.jerk = Math.max(this.jerk, speed);
      const upwardSpeed = (pointerHeight - this.lastPointer.height) / seconds;
      const travelled = pointerHeight - (this.jumpGestureLow ?? pointerHeight);
      if (supported && pointerHeight >= JUMP_POINTER_HEIGHT
          && travelled >= MIN_JUMP_POINTER_TRAVEL && upwardSpeed > this.settings.jerkThr
          && this.elapsed >= this.jumpUntil) {
        this.jumpUntil = this.elapsed + .2;
        this.jumpStrength = clamp((upwardSpeed - this.settings.jerkThr) / this.settings.jerkRange, .35, 1);
        this.launchLean = Math.abs(this.jumpGestureStartX) < .12 ? 0 : this.jumpGestureStartX;
        const sidewaysStroke = x - this.jumpGestureStartX;
        this.launchSpinLean = Math.abs(sidewaysStroke) >= .1
          ? clamp(sidewaysStroke * 2.5, -1, 1) : this.launchLean;
        this.jumpGestureLow = null;
        this.landingTime = 0;
      }
    }
    this.lastPointer = { x, y, height: pointerHeight, time: now };
    this.mouse.x = x;
    this.mouse.y = y;
  }

  drive(dt) {
    const K = this.settings, P = this.bodies, J = this.joints;
    const airborne = this.footContacts === 0 && (this.jumping || this.airTime > .06);
    const targets = postureTargets(this.mouse, airborne, K.tuckAmount);
    this.groundTimer = this.footContacts > 0 ? 14 : Math.max(0, this.groundTimer - 1);
    const grounded = !airborne && this.groundTimer > 0;
    const shinAngle = normalizeAngle(P.shin.getAngle());
    const footAngle = normalizeAngle(P.foot.getAngle());
    const flatTarget = clamp(shinAngle, -1, 1.65);
    if (!grounded && !airborne) targets.ankle = flatTarget;
    if (grounded) {
      targets.ankle = Math.abs(footAngle) > .2 ? flatTarget : 0;
      targets.knee += K.kneeComp * Math.max(0, this.mouse.x);
    }
    // Short or low mouse flicks only change posture; they cannot release the stance.
    const launching = this.elapsed < this.jumpUntil;
    const strength = launching ? 1 - this.jumpStrength : 1;
    this.lockStrength = strength;
    const recovery = clamp(1 - this.landingTime / LANDING_RECOVERY, 0, 1);
    const motorStrength = .12 + .88 * recovery * recovery;
    J.ankle.setMaxMotorTorque((grounded ? 300 + K.ankleLock * strength : 1500) * motorStrength);
    J.knee.setMaxMotorTorque(K.kneeTorque * motorStrength);
    J.hip.setMaxMotorTorque(K.hipTorque * motorStrength);
    J.neck.setMaxMotorTorque(120 * motorStrength);
    J.sh.setMaxMotorTorque(160 * motorStrength);
    J.el.setMaxMotorTorque(60 * motorStrength);
    J.knee.vmax = K.kneeV;
    J.hip.vmax = K.hipV;
    J.ankle.vmax = K.ankleV;
    J.sh.vmax = K.shV;

    // A mouse jerk releases the planted foot and the balancing assistance.
    if (grounded) {
      const support = P.foot.getWorldPoint(V(0, -bodyParts.foot.h / 2));
      let mass = 0, centerX = 0, velocityX = 0, supportInertia = 0;
      for (const body of Object.values(P)) {
        const m = body.getMass(), center = body.getWorldCenter();
        mass += m;
        centerX += m * center.x;
        velocityX += m * body.getLinearVelocity().x;
        // The planted foot carries every segment, not just its own small inertia.
        supportInertia += body.getInertia()
          + m * ((center.x - support.x) ** 2 + (center.y - support.y) ** 2);
      }
      centerX /= mass;
      velocityX /= mass;
      if (this.footContacts > 0 && !this.jumping) {
        const stiffness = 1800;
        const damping = 2 * Math.sqrt(stiffness * supportInertia);
        const gravityMoment = K.gravity * mass * (centerX - support.x);
        const torque = (gravityMoment - stiffness * footAngle
          - (damping + stiffness * dt) * P.foot.getAngularVelocity())
          * supportInertia / (supportInertia + damping * dt + stiffness * dt * dt);
        const maximum = K.footHold * strength * motorStrength;
        P.foot.applyTorque(clamp(torque, -maximum, maximum), true);
      }
      // Balance over the ankle before the weight reaches the heel. The toe extends
      // farther forward than the heel, so the rectangle's center is not the ankle.
      const ankle = P.foot.getWorldPoint(V(-.06, bodyParts.foot.h / 2));
      const wanted = ankle.x + .02 + .1 * this.mouse.x;
      const predictedError = centerX - wanted + .2 * velocityX;
      const quietRadius = .012;
      const error = Math.sign(predictedError) * Math.max(0, Math.abs(predictedError) - quietRadius);
      const adjustment = clamp(K.balance * error, -1.3, 1.3);
      this.balanceAdjustment += (adjustment - this.balanceAdjustment) * (1 - Math.exp(-24 * dt));
    } else {
      this.balanceAdjustment = 0;
    }

    // Ease into the initial pose without bouncing on spawn.
    if (this.elapsed < .9) {
      const ratio = this.elapsed / .9;
      const ease = ratio * ratio * (3 - 2 * ratio);
      for (const key in targets) targets[key] *= ease;
    }
    // The spawn transition eases the requested pose, never the balance correction.
    if (grounded) targets.hip += strength * this.balanceAdjustment;
    // Resume pose control from the landed pose instead of kicking against the rock.
    if (this.landingTime > 0 && this.landingTargets) {
      const ratio = recovery;
      const ease = ratio * ratio * (3 - 2 * ratio);
      for (const key in targets) {
        targets[key] = this.landingTargets[key] + (targets[key] - this.landingTargets[key]) * ease;
      }
    }
    for (const [key, joint] of Object.entries(J)) {
      const error = targets[key] - joint.getJointAngle();
      const standing = grounded && !launching && !this.jumping;
      const damping = Math.max(standing ? .6 : 0, this.landingTime > 0 ? .6 * (1 - recovery) : 0);
      const speed = (K.kp * error - damping * joint.getJointSpeed()) / (1 + damping);
      const stanceMaximum = key === 'ankle' ? 4 : key === 'hip' ? 6 : key === 'knee' ? 3 : 4;
      const maximum = Math.min(joint.vmax, standing ? stanceMaximum : joint.vmax)
        * (.15 + .85 * recovery * recovery);
      let command = clamp(speed, -maximum, maximum);
      if (standing) {
        // Smooth extension at the knee, while letting the hip/ankle catch a lean.
        if (key !== 'hip' && key !== 'ankle') {
          const previous = this.motorSpeeds[key] ?? 0;
          const acceleration = key === 'knee' ? 8 : 16;
          command = clamp(command, previous - acceleration * dt, previous + acceleration * dt);
        }
        if (Math.abs(error) < .008 && Math.abs(joint.getJointSpeed()) < .04) command = 0;
      }
      this.motorSpeeds[key] = command;
      joint.setMotorSpeed(command);
    }
  }

  takeoff() {
    if (this.jumping || this.elapsed >= this.jumpUntil) return;
    const strength = 1 - this.lockStrength;
    if (strength < .3) return;
    let mass = 0, velocityY = 0;
    for (const body of Object.values(this.bodies)) {
      const m = body.getMass();
      mass += m;
      velocityY += m * body.getLinearVelocity().y;
    }
    if (velocityY / mass < .5) return;
    this.jumping = true;
    this.jumpUntil = 0;
    this.jumpGestureLow = null;
    // Crouched lean controls travel; the upward stroke independently controls spin.
    const lean = this.launchLean;
    const push = (lean > 0 ? this.settings.pushForward : this.settings.pushBackward) * lean * strength;
    for (const body of Object.values(this.bodies)) {
      const velocity = body.getLinearVelocity();
      body.setLinearVelocity(V(velocity.x + push, velocity.y));
    }
    this.applyTakeoffSpin(strength);
  }

  applyTakeoffSpin(strength) {
    const wantedSpin = -this.settings.spin * this.launchSpinLean * strength;
    let mass = 0, centerX = 0, centerY = 0, velocityX = 0, velocityY = 0;
    for (const body of Object.values(this.bodies)) {
      const m = body.getMass(), center = body.getWorldCenter(), velocity = body.getLinearVelocity();
      mass += m;
      centerX += m * center.x; centerY += m * center.y;
      velocityX += m * velocity.x; velocityY += m * velocity.y;
    }
    centerX /= mass; centerY /= mass;
    velocityX /= mass; velocityY /= mass;
    let inertia = 0, momentum = 0;
    for (const body of Object.values(this.bodies)) {
      const center = body.getWorldCenter(), velocity = body.getLinearVelocity();
      const x = center.x - centerX, y = center.y - centerY, m = body.getMass();
      inertia += body.getInertia() + m * (x * x + y * y);
      momentum += body.getInertia() * body.getAngularVelocity()
        + m * (x * (velocity.y - velocityY) - y * (velocity.x - velocityX));
    }
    // Apply once at takeoff, preserving the independent horizontal launch speed.
    const change = wantedSpin - momentum / inertia;
    for (const body of Object.values(this.bodies)) {
      const center = body.getWorldCenter(), velocity = body.getLinearVelocity();
      body.setLinearVelocity(V(
        velocity.x - change * (center.y - centerY),
        velocity.y + change * (center.x - centerX),
      ));
      body.setAngularVelocity(body.getAngularVelocity() + change);
    }
  }

  centerOfMassHeight() {
    let mass = 0, height = 0;
    for (const body of Object.values(this.bodies)) {
      const m = body.getMass();
      mass += m;
      height += m * body.getWorldCenter().y;
    }
    return height / mass;
  }

  updateAirSpin(dt) {
    if (this.footContacts > 0 || this.limp || this.entered || this.landingTime > 0
        || (!this.jumping && this.airTime <= .06)) {
      this.airSpinFactor = 1;
      this.airSpinPeakFactor = 1;
      this.straightAirTime = 0;
      return;
    }
    // Use the simulated pose, so rotation increases as the limbs actually fold.
    const kneeTuck = clamp(this.joints.knee.getJointAngle() / AIR_TUCK_KNEE, 0, 1);
    const hipTuck = clamp(-this.joints.hip.getJointAngle() / AIR_TUCK_HIP, 0, 1);
    const tuck = Math.min(kneeTuck, hipTuck);
    const extended = Math.abs(this.joints.knee.getJointAngle()) < .25
      && Math.abs(this.joints.hip.getJointAngle()) < .25;
    this.straightAirTime = extended ? this.straightAirTime + dt : 0;
    // Brief extension reduces speed without nearly arresting the ongoing flip.
    const desiredFactor = .7 + .9 * tuck * tuck;
    const factor = this.airSpinFactor
      + (desiredFactor - this.airSpinFactor) * (1 - Math.exp(-12 * dt));

    let mass = 0, centerX = 0, centerY = 0, velocityX = 0, velocityY = 0;
    for (const body of Object.values(this.bodies)) {
      const m = body.getMass(), center = body.getWorldCenter(), velocity = body.getLinearVelocity();
      mass += m;
      centerX += m * center.x;
      centerY += m * center.y;
      velocityX += m * velocity.x;
      velocityY += m * velocity.y;
    }
    centerX /= mass; centerY /= mass;
    velocityX /= mass; velocityY /= mass;
    let inertia = 0, momentum = 0;
    for (const body of Object.values(this.bodies)) {
      const center = body.getWorldCenter(), velocity = body.getLinearVelocity();
      const x = center.x - centerX, y = center.y - centerY, m = body.getMass();
      inertia += body.getInertia() + m * (x * x + y * y);
      momentum += body.getInertia() * body.getAngularVelocity()
        + m * (x * (velocity.y - velocityY) - y * (velocity.x - velocityX));
    }
    // Spend the extra tuck boost only when reaching a new maximum compactness
    // during this flight. Refolding cannot refund momentum lost while extended;
    // the smaller physical inertia still increases the remaining rotation naturally.
    const poseScale = factor > this.airSpinFactor
      ? Math.max(1, factor / this.airSpinPeakFactor)
      : factor / this.airSpinFactor;
    // Extra dissipation starts only after two continuous seconds fully extended.
    const prolongedBrake = 1.6 * clamp((this.straightAirTime - 2) / 2, 0, 1);
    const rotationScale = poseScale * Math.exp(-prolongedBrake * dt);
    const extraSpin = momentum / inertia * (rotationScale - 1);
    for (const body of Object.values(this.bodies)) {
      const center = body.getWorldCenter(), velocity = body.getLinearVelocity();
      body.setLinearVelocity(V(
        velocity.x - extraSpin * (center.y - centerY),
        velocity.y + extraSpin * (center.x - centerX),
      ));
      body.setAngularVelocity(body.getAngularVelocity() + extraSpin);
    }
    this.airSpinFactor = factor;
    this.airSpinPeakFactor = Math.max(this.airSpinPeakFactor, factor);
  }

  land() {
    const normal = this.landingNormal;
    const absorbImpact = this.jumpRise > MIN_ABSORBED_JUMP_HEIGHT;
    this.jumping = false;
    this.jumpUntil = 0;
    this.jumpGestureLow = null;
    this.jumpStrength = 0;
    this.takeoffHeight = null;
    this.jumpRise = 0;
    this.landingNormal = null;
    if (!absorbImpact) {
      // A small hop keeps normal contact physics and full motor response.
      this.landingTime = 0;
      this.landingTargets = null;
      return;
    }
    const tangent = V(normal.y, -normal.x);
    let mass = 0, tangentMomentum = 0;
    for (const body of Object.values(this.bodies)) {
      const velocity = body.getLinearVelocity(), m = body.getMass();
      mass += m;
      tangentMomentum += m * (velocity.x * tangent.x + velocity.y * tangent.y);
    }
    // Absorb the normal impact and most sliding energy. Giving every segment the
    // same residual velocity also removes the relative motion that re-excites joints.
    const slide = clamp(tangentMomentum / mass * .1, -.2, .2);
    for (const body of Object.values(this.bodies)) {
      body.setLinearVelocity(V(tangent.x * slide, tangent.y * slide));
      body.setAngularVelocity(0);
    }
    this.balanceAdjustment = 0;
    this.jerk = 0;
    this.landingTargets = Object.fromEntries(
      Object.entries(this.joints).map(([key, joint]) => [key, joint.getJointAngle()]),
    );
    this.landingTime = LANDING_RECOVERY;
    for (const joint of Object.values(this.joints)) joint.setMotorSpeed(0);
  }

  limitLandingEnergy() {
    if (this.landingTime <= 0 || this.limp || this.entered) return;
    let mass = 0, energy = 0;
    for (const body of Object.values(this.bodies)) {
      const velocity = body.getLinearVelocity(), m = body.getMass();
      mass += m;
      energy += .5 * m * (velocity.x ** 2 + velocity.y ** 2)
        + .5 * body.getInertia() * body.getAngularVelocity() ** 2;
    }
    const recovery = clamp(1 - this.landingTime / LANDING_RECOVERY, 0, 1);
    const speedLimit = .1 + .35 * recovery;
    const budget = .5 * mass * speedLimit ** 2;
    if (energy <= budget) return;
    const scale = Math.sqrt(budget / energy);
    // Uniform scaling preserves joint velocity relationships while removing energy.
    for (const body of Object.values(this.bodies)) {
      const velocity = body.getLinearVelocity();
      body.setLinearVelocity(V(velocity.x * scale, velocity.y * scale));
      body.setAngularVelocity(body.getAngularVelocity() * scale);
    }
  }

  stabilizeFoot() {
    if (this.limp || this.entered || this.jumping || this.elapsed < this.jumpUntil
        || this.groundTimer === 0) return;
    const foot = this.bodies.foot;
    const center = foot.getPosition();
    const angle = foot.getAngle();
    const extent = (Math.abs(Math.sin(angle)) * bodyParts.foot.w
      + Math.abs(Math.cos(angle)) * bodyParts.foot.h) / 2;
    let supported = false;
    // Only suppress lift directly above a real surface; walking off an edge still falls.
    this.world.rayCast(center, V(center.x, center.y - extent - .06), (fixture, point, normal, fraction) => {
      if (fixture.getBody().getUserData() !== 'cliff') return -1;
      if (normal.y > .5) supported = true;
      return fraction;
    });
    if (supported) {
      const velocity = foot.getLinearVelocity();
      if (velocity.y > 0) foot.setLinearVelocity(V(velocity.x, 0));
    }
  }

  evaluateEntry() {
    const P = this.bodies, J = this.joints;
    const parts = [P.head, P.foot, P.farm];
    const lowest = parts.reduce((low, part) => part.getPosition().y < low.getPosition().y ? part : low);
    if (lowest.getPosition().y >= 0) return;
    this.entered = true;
    const head = P.head.getPosition(), foot = P.foot.getPosition();
    const angle = Math.atan2(head.x - foot.x, head.y - foot.y);
    const deviation = Math.min(Math.abs(angle), Math.PI - Math.abs(angle));
    const straight = 1 - Math.min(1, (Math.abs(J.knee.getJointAngle()) + Math.abs(J.hip.getJointAngle())) / 1.6);
    const middle = (this.level.b[0] + this.level.b[1]) / 2;
    const half = (this.level.b[1] - this.level.b[0]) / 2;
    const distance = Math.abs(lowest.getPosition().x - middle);
    const angleScore = Math.pow(Math.max(0, 1 - deviation / .9), 1.3);
    const positionScore = Math.max(0, 1 - .5 * distance / half);
    if (this.score === null) {
      this.score = Math.min(10, Math.round(100 * angleScore * (.7 + .3 * straight) * positionScore) / 10);
    }
    this.entryInfo = `Угол: ${Math.round(deviation * 57.3)}° от вертикали · от центра: ${distance.toFixed(1)} м`;
  }

  step(dt) {
    const K = this.settings;
    this.elapsed += dt;
    this.jerk *= Math.exp(-dt * K.jerkDecay);
    this.world.setGravity(V(0, -K.gravity));
    if (!this.limp) this.drive(dt);
    const standing = this.footContacts > 0 && !this.jumping && this.elapsed >= this.jumpUntil;
    for (const body of Object.values(this.bodies)) {
      if (body.getPosition().y < 0) {
        body.setLinearDamping(K.waterDamp);
        body.setAngularDamping(K.waterDamp * .8);
        body.applyForceToCenter(V(0, body.getMass() * 14), true);
      } else {
        body.setLinearDamping(this.landingTime > 0 ? 7 : standing ? 1.2 : .02);
        body.setAngularDamping(this.landingTime > 0 ? 3 : standing ? 2.5 : .05);
      }
    }
    const previousContacts = this.footContacts;
    const supportedHeight = previousContacts > 0 ? this.centerOfMassHeight() : null;
    this.world.step(dt, 10, 6);
    if (previousContacts > 0 && this.footContacts === 0) {
      this.takeoffHeight = supportedHeight;
      this.jumpRise = 0;
      this.landingTime = 0;
      this.landingTargets = null;
    }
    if (this.takeoffHeight !== null) {
      this.jumpRise = Math.max(this.jumpRise, this.centerOfMassHeight() - this.takeoffHeight);
    }
    if (this.landing) {
      this.landing = false;
      if (!this.limp && !this.entered) this.land();
    }
    if (this.footContacts > 0) {
      this.takeoffHeight = null;
      this.jumpRise = 0;
    }
    if (previousContacts > 0 && this.footContacts === 0 && !this.limp && !this.entered) this.takeoff();
    this.limitLandingEnergy();
    this.stabilizeFoot();
    this.airTime = this.footContacts > 0 ? 0 : this.airTime + dt;
    this.landingTime = Math.max(0, this.landingTime - dt);
    if (!this.entered) this.evaluateEntry();
    this.updateAirSpin(dt);
    if (!this.done && this.entered && this.bodies.torso.getPosition().y < -2.2) {
      this.done = true;
      this.onFinish({ score: this.score ?? 0, info: this.entryInfo });
    }
  }
}
