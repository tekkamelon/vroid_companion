import * as THREE from '../../node_modules/three/build/three.module.js';

// === クォータニオン計算用の共通インスタンス ===
// 毎フレーム使い回すため、new を回避してパフォーマンスを維持する
const idleEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const idleQuat = new THREE.Quaternion();

// === 角度 → クォータニオン変換ユーティリティ ===
// VRM ボーンに直接差し込める float[4] 形式で返す
function idleRotation(x = 0, y = 0, z = 0) {
    idleEuler.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z));
    return new THREE.Quaternion().setFromEuler(idleEuler).toArray();
}

// === 両手の指の自然な曲がり(アイドルポーズ) ===
// VRM の Humanoid に対する normalized pose(回転差分)として定義
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

// === 主要ボーンのベース姿勢(呼吸・微動の基準となるオフセット) ===
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

// === アイドルモーションのランタイム状態 ===
let idleMotion = null;

// === VRM Humanoid からボーンノードを取得 ===
// @pixiv/three-vrm の API バリエーションに対応(normalized / raw)
function getHumanoidBone(humanoid, name) {
    return humanoid?.getNormalizedBoneNode?.(name) ?? humanoid?.getRawBoneNode?.(name) ?? null;
}

// === アイドルモーションの初期化 ===
// VRM ロード後に呼び出し、ベース姿勢を保存して後から復元できるようにする
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

// === 単一ボーンに対して「ベース + 動的オフセット」を適用 ===
// 初期姿勢(rest)に対して相対回転を乗算し、自然なアイドル微動を表現する
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

// === フレーム毎のアイドルモーション更新 ===
// 呼吸・体揺れ・腕の揺れ・ヘッドドリフトを重ね合わせてリアルな立ち姿を再現
export function updateIdleMotion(vrm, delta) {
    if (!idleMotion || !vrm) return;

    idleMotion.elapsed += delta;
    const t = idleMotion.elapsed;

    // 複数のサイン波を重ねて非周期的な微動を演出
    const breath = Math.sin(t * Math.PI * 2 * 0.28);
    const slowShift = Math.sin(t * Math.PI * 2 * 0.12);
    const headDrift = Math.sin(t * Math.PI * 2 * 0.16 + 0.8);
    const armSway = Math.sin(t * Math.PI * 2 * 0.2 + 1.4);

    // --- 全体の上下(息に合わせた体の浮き沈み) ---
    vrm.scene.position.y = idleMotion.baseSceneY + breath * 0.008;

    // --- 指のポーズを適用(左右対称の自然な握り) ---
    vrm.humanoid?.setNormalizedPose?.(IDLE_FINGER_POSE);

    // --- 各ボーンへの微動適用 ---
    // 脊椎・胸部：呼吸に連動した前後・左右の揺れ
    applyIdleBonePose('spine', { x: breath * 0.012, z: slowShift * 0.01 });
    applyIdleBonePose('chest', { x: breath * -0.018, z: slowShift * 0.006 });

    // 首・頭：少し遅れた位相でふわふわと動く
    applyIdleBonePose('neck', { x: breath * 0.006, y: headDrift * 0.012 });
    applyIdleBonePose('head', { x: breath * -0.008, y: headDrift * 0.018, z: slowShift * 0.006 });

    // 肩：腕の揺れに連動した微動
    applyIdleBonePose('leftShoulder', { z: armSway * 0.008 });
    applyIdleBonePose('rightShoulder', { z: -armSway * 0.008 });

    // 上腕：腕全体の揺れと呼吸の合成
    applyIdleBonePose('leftUpperArm', { x: breath * 0.008, z: armSway * 0.012 });
    applyIdleBonePose('rightUpperArm', { x: breath * 0.008, z: -armSway * 0.012 });

    // 前腕・手：先端ほど振幅を抑えた慣性揺れ
    applyIdleBonePose('leftLowerArm', { z: armSway * 0.01 });
    applyIdleBonePose('rightLowerArm', { z: -armSway * 0.01 });
    applyIdleBonePose('leftHand', { z: armSway * 0.012 });
    applyIdleBonePose('rightHand', { z: -armSway * 0.012 });
}
