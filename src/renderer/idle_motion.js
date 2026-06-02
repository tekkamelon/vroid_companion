import * as THREE from '../../node_modules/three/build/three.module.js';

const idleEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const idleQuat = new THREE.Quaternion();

function idleRotation(x = 0, y = 0, z = 0) {
    idleEuler.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z));
    return new THREE.Quaternion().setFromEuler(idleEuler).toArray();
}

const IDLE_FINGER_POSE = {
    leftThumbMetacarpal: { rotation: idleRotation(4, -10, 10) },
    leftThumbProximal: { rotation: idleRotation(4, -4, 12) },
    leftThumbDistal: { rotation: idleRotation(2, 0, 8) },
    leftIndexProximal: { rotation: idleRotation(3, 0, 18) },
    leftIndexIntermediate: { rotation: idleRotation(2, 0, 20) },
    leftIndexDistal: { rotation: idleRotation(1, 0, 12) },
    leftMiddleProximal: { rotation: idleRotation(3, 0, 22) },
    leftMiddleIntermediate: { rotation: idleRotation(2, 0, 24) },
    leftMiddleDistal: { rotation: idleRotation(1, 0, 14) },
    leftRingProximal: { rotation: idleRotation(3, 0, 25) },
    leftRingIntermediate: { rotation: idleRotation(2, 0, 27) },
    leftRingDistal: { rotation: idleRotation(1, 0, 16) },
    leftLittleProximal: { rotation: idleRotation(3, 0, 28) },
    leftLittleIntermediate: { rotation: idleRotation(2, 0, 30) },
    leftLittleDistal: { rotation: idleRotation(1, 0, 17) },
    rightThumbMetacarpal: { rotation: idleRotation(4, 10, -10) },
    rightThumbProximal: { rotation: idleRotation(4, 4, -12) },
    rightThumbDistal: { rotation: idleRotation(2, 0, -8) },
    rightIndexProximal: { rotation: idleRotation(3, 0, -18) },
    rightIndexIntermediate: { rotation: idleRotation(2, 0, -20) },
    rightIndexDistal: { rotation: idleRotation(1, 0, -12) },
    rightMiddleProximal: { rotation: idleRotation(3, 0, -22) },
    rightMiddleIntermediate: { rotation: idleRotation(2, 0, -24) },
    rightMiddleDistal: { rotation: idleRotation(1, 0, -14) },
    rightRingProximal: { rotation: idleRotation(3, 0, -25) },
    rightRingIntermediate: { rotation: idleRotation(2, 0, -27) },
    rightRingDistal: { rotation: idleRotation(1, 0, -16) },
    rightLittleProximal: { rotation: idleRotation(3, 0, -28) },
    rightLittleIntermediate: { rotation: idleRotation(2, 0, -30) },
    rightLittleDistal: { rotation: idleRotation(1, 0, -17) },
};

const IDLE_BONE_POSE = {
    spine: { x: THREE.MathUtils.degToRad(2) },
    chest: { x: THREE.MathUtils.degToRad(-3) },
    neck: { x: THREE.MathUtils.degToRad(2) },
    head: { x: THREE.MathUtils.degToRad(-2) },
    leftShoulder: { z: THREE.MathUtils.degToRad(-4) },
    rightShoulder: { z: THREE.MathUtils.degToRad(4) },
    leftUpperArm: { x: THREE.MathUtils.degToRad(3), y: THREE.MathUtils.degToRad(4), z: THREE.MathUtils.degToRad(64) },
    rightUpperArm: { x: THREE.MathUtils.degToRad(3), y: THREE.MathUtils.degToRad(-4), z: THREE.MathUtils.degToRad(-64) },
    leftLowerArm: { y: THREE.MathUtils.degToRad(8), z: THREE.MathUtils.degToRad(10) },
    rightLowerArm: { y: THREE.MathUtils.degToRad(-8), z: THREE.MathUtils.degToRad(-10) },
    leftHand: { x: THREE.MathUtils.degToRad(2), z: THREE.MathUtils.degToRad(4) },
    rightHand: { x: THREE.MathUtils.degToRad(2), z: THREE.MathUtils.degToRad(-4) },
};

let idleMotion = null;

function getHumanoidBone(humanoid, name) {
    return humanoid?.getNormalizedBoneNode?.(name) ?? humanoid?.getRawBoneNode?.(name) ?? null;
}

export function setupIdleMotion(vrm) {
    const humanoid = vrm?.humanoid;
    const bones = new Map();
    Object.keys(IDLE_BONE_POSE).forEach((name) => {
        const node = getHumanoidBone(humanoid, name);
        if (node) bones.set(name, { node, rest: node.quaternion.clone() });
    });

    idleMotion = {
        elapsed: 0,
        baseSceneY: vrm?.scene?.position.y ?? 0,
        bones,
    };
}

function applyIdleBonePose(name, motion = {}) {
    const bone = idleMotion?.bones.get(name);
    if (!bone) return;

    const base = IDLE_BONE_POSE[name] ?? {};
    idleEuler.set(
        (base.x ?? 0) + (motion.x ?? 0),
        (base.y ?? 0) + (motion.y ?? 0),
        (base.z ?? 0) + (motion.z ?? 0),
    );
    idleQuat.setFromEuler(idleEuler);
    bone.node.quaternion.copy(bone.rest).multiply(idleQuat);
}

export function updateIdleMotion(vrm, delta) {
    if (!idleMotion || !vrm) return;

    idleMotion.elapsed += delta;
    const t = idleMotion.elapsed;
    const breath = Math.sin(t * Math.PI * 2 * 0.28);
    const slowShift = Math.sin(t * Math.PI * 2 * 0.12);
    const headDrift = Math.sin(t * Math.PI * 2 * 0.16 + 0.8);
    const armSway = Math.sin(t * Math.PI * 2 * 0.2 + 1.4);

    vrm.scene.position.y = idleMotion.baseSceneY + breath * 0.008;
    vrm.humanoid?.setNormalizedPose?.(IDLE_FINGER_POSE);

    applyIdleBonePose('spine', { x: breath * 0.012, z: slowShift * 0.01 });
    applyIdleBonePose('chest', { x: breath * -0.018, z: slowShift * 0.006 });
    applyIdleBonePose('neck', { x: breath * 0.006, y: headDrift * 0.012 });
    applyIdleBonePose('head', { x: breath * -0.008, y: headDrift * 0.018, z: slowShift * 0.006 });
    applyIdleBonePose('leftShoulder', { z: armSway * 0.008 });
    applyIdleBonePose('rightShoulder', { z: -armSway * 0.008 });
    applyIdleBonePose('leftUpperArm', { x: breath * 0.008, z: armSway * 0.012 });
    applyIdleBonePose('rightUpperArm', { x: breath * 0.008, z: -armSway * 0.012 });
    applyIdleBonePose('leftLowerArm', { z: armSway * 0.01 });
    applyIdleBonePose('rightLowerArm', { z: -armSway * 0.01 });
    applyIdleBonePose('leftHand', { z: armSway * 0.012 });
    applyIdleBonePose('rightHand', { z: -armSway * 0.012 });
}
