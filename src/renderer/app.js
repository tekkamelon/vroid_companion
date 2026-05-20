// VRoid Companion — レンダラープロセス
// three.js + @pixiv/three-vrm はnpmからbundleせず、
// 開発中はCDNまたはnode_modules直参照を使うこと。
// (Electronはfile://でnode_modulesにアクセス可能)

import * as THREE from '../../node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../../node_modules/@pixiv/three-vrm/lib/three-vrm.module.js';

const canvas = document.getElementById('vrm-canvas');
const log    = document.getElementById('log');
const input  = document.getElementById('msg-input');
const btn    = document.getElementById('send-btn');

// ---- Three.js セットアップ ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20);
camera.position.set(0, 1.4, 3);

const light = new THREE.DirectionalLight(0xffffff, 1.0);
light.position.set(1, 2, 3);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

let currentVrm = null;

// ---- VRMロード ----
function loadVrm(url) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(url, (gltf) => {
        if (currentVrm) { scene.remove(currentVrm.scene); VRMUtils.deepDispose(currentVrm.scene); }
        currentVrm = gltf.userData.vrm;
        VRMUtils.removeUnnecessaryVertices(currentVrm.scene);
        VRMUtils.combineSkeletons(currentVrm.scene);
        currentVrm.scene.rotation.y = Math.PI;
        scene.add(currentVrm.scene);
    });
}

// ---- レンダーループ ----
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (currentVrm) currentVrm.update(delta);
    renderer.render(scene, camera);
}
animate();

// ---- 表情制御ユーティリティ ----
function setExpression(name, weight) {
    if (!currentVrm?.expressionManager) return;
    currentVrm.expressionManager.setValue(name, weight);
}

// ---- チャットUI ----
function appendLog(who, text) {
    const p = document.createElement('p');
    p.textContent = `[${who}] ${text}`;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
}

async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendLog('You', text);
    const resp = await window.companion.sendMessage(text);
    if (resp?.text) appendLog('AI', resp.text);
    if (resp?.emotion) setExpression(resp.emotion, resp.intensity ?? 1.0);
}

btn.addEventListener('click', sendMessage);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

window.companion.onResponse((data) => {
    if (data?.text) appendLog('AI', data.text);
    if (data?.emotion) setExpression(data.emotion, data.intensity ?? 1.0);
});

// ---- 初期VRMロード (モデルがあれば) ----
// loadVrm('./assets/models/model.vrm');
