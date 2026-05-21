// VRoid Companion — レンダラープロセス
// three.js + @pixiv/three-vrm はnpmからbundleせず、
// 開発中はnode_modules直参照を使う。
// (Electronはfile://でnode_modulesにアクセス可能)

// three.js コアライブラリを読み込む
import * as THREE from '../../node_modules/three/build/three.module.js';
// GLTF形式の3Dモデルを読み込むためのローダー
import { GLTFLoader } from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
// VRMモデルの読み込みとユーティリティ機能
import { VRMLoaderPlugin, VRMUtils } from '../../node_modules/@pixiv/three-vrm/lib/three-vrm.module.js';

// DOM 要素への参照を取得する
const canvas = document.getElementById('vrm-canvas');
const canvasArea = document.getElementById('canvas-area');
const log    = document.getElementById('log');
const input  = document.getElementById('msg-input');
const btn    = document.getElementById('send-btn');
const bootNote = document.getElementById('boot-note');

// ステータス表示用の要素を動的に作成して body に追加する
const status = document.createElement('div');
status.id = 'status';
status.textContent = 'starting...';
document.body.appendChild(status);

// 画面上部のステータスと起動ノートにテキストを反映する
function report(text) {
    status.textContent = text;
    if (bootNote) bootNote.textContent = text;
}

// グローバルな JavaScript エラーを捕捉して表示する
window.addEventListener('error', (event) => {
    report(`JS error: ${event.message}`);
    console.error(event.error ?? event.message);
});

// 未ハンドルの Promise 拒否を捕捉して表示する
window.addEventListener('unhandledrejection', (event) => {
    report(`Promise rejected: ${event.reason?.message ?? event.reason}`);
    console.error(event.reason);
});

// Content Security Policy 違反を検出してログに記録する
window.addEventListener('securitypolicyviolation', (event) => {
    appendLog('Debug', `CSP violation: ${event.violatedDirective} blocked=${event.blockedURI}`);
    console.warn('[CSP]', event.violatedDirective, event.blockedURI);
});

// ---- Three.js セットアップ ----

// WebGL レンダラーを作成して初期設定を行う
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.setClearColor(0x1a1a2e, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
report(`WebGL ${renderer.capabilities.isWebGL2 ? '2' : '1'} ready`);

// 3D シーンを作成する
const scene  = new THREE.Scene();

// カメラを作成して初期位置を設定する
const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20);
camera.position.set(0, 1.4, 3);

// 半球ライト: 空と地面からの自然な環境光をシミュレートする
const hemiLight = new THREE.HemisphereLight(0xc8d9ff, 0x223355, 1.2);
scene.add(hemiLight);

// キーライト: メインの方向性ライト（太陽光のような主光源）
const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(1.5, 3.0, 2.0);
scene.add(keyLight);

// フィルライト: 影の部分を柔らかく照らす補助光
const fillLight = new THREE.DirectionalLight(0x88aaff, 0.6);
fillLight.position.set(-2.0, 1.0, 1.0);
scene.add(fillLight);

// シーンの背景色を設定する
scene.background = new THREE.Color(0x1a1a2e);

// 床のグリッドを表示する（デバッグ用の目安）
scene.add(new THREE.GridHelper(10, 10, 0x6ba4ff, 0x2e3658));

// 現在読み込まれている VRM モデルの参照
let currentVrm = null;

// カメラが向くターゲット位置を保持するベクトル
const cameraTarget = new THREE.Vector3();

// VRM モデルのバウンディングボックス情報を保持するオブジェクト
let framing = null;

// レンダラーのサイズを canvas エリアに合わせて調整する
function resizeRenderer() {
    const width = canvasArea?.clientWidth ?? canvas.clientWidth;
    const height = canvasArea?.clientHeight ?? canvas.clientHeight;
    if (!width || !height) return;

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height, true);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCurrentVrm();
    report(`renderer ${width}x${height}`);
}

// canvas エリアのサイズ変更を監視して自動的にリサイズする
const resizeObserver = new ResizeObserver(() => {
    resizeRenderer();
    frameCurrentVrm();
});
if (canvasArea) resizeObserver.observe(canvasArea);

// 現在の VRM モデルにカメラを適切にフレーミングする
function frameCurrentVrm() {
    if (!currentVrm || !framing) return;

    // カメラの縦横視野角を計算する
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const topY = framing.sizeY / 2;
    const fullHeight = framing.sizeY;

    // 「頭頂〜太もも」を基準に、縦横の占有率が一定になる距離を計算する。
    const focusTop = topY - fullHeight * 0.01;
    const focusBottom = topY - fullHeight * 0.76;
    const focusHeight = focusTop - focusBottom;
    const focusCenterY = (focusTop + focusBottom) * 0.5;

    // 目標占有率:
    // - 縦: 78% 程度で下余白を抑える
    // - 横: 62% 程度で横長時の余白を抑える
    const targetFillY = 0.78;
    const targetFillX = 0.62;
    const torsoWidth = fullHeight * 0.64;
    const distanceByHeight = (focusHeight * 0.5) / (Math.tan(vFov / 2) * targetFillY);
    const distanceByWidth = (torsoWidth * 0.5) / (Math.tan(hFov / 2) * targetFillX);
    const distance = Math.max(distanceByHeight, distanceByWidth) * 1.01;

    // カメラの位置とクリッピング面を調整する
    camera.position.set(0, focusCenterY + fullHeight * 0.09, distance);
    camera.near = Math.max(distance / 100, 0.01);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    cameraTarget.set(0, focusCenterY + fullHeight * 0.07, 0);
    camera.lookAt(cameraTarget);
}

// ---- VRMロード ----

// 指定された URL から VRM モデルを読み込む
function loadVrm(url) {
    // ローディングの進捗状況を管理するマネージャー
    const loadingManager = new THREE.LoadingManager();
    loadingManager.onStart = (loaded, total, resourceUrl) => {
        appendLog('Debug', `loading start ${loaded}/${total} ${resourceUrl ?? ''}`);
    };
    loadingManager.onProgress = (resourceUrl, loaded, total) => {
        appendLog('Debug', `loading progress ${loaded}/${total} ${resourceUrl ?? ''}`);
    };
    loadingManager.onLoad = () => {
        appendLog('Debug', 'loading manager complete');
    };
    loadingManager.onError = (resourceUrl) => {
        appendLog('Debug', `loading error ${resourceUrl ?? '(unknown)'}`);
    };

    // GLTFLoader に VRM プラグインを登録して VRM 対応にする
    const loader = new GLTFLoader(loadingManager);
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
        url,
        (gltf) => {
            // 既存の VRM モデルがあればシーンから削除してメモリを解放する
            if (currentVrm) { scene.remove(currentVrm.scene); VRMUtils.deepDispose(currentVrm.scene); }
            currentVrm = gltf.userData.vrm;

            // マテリアル情報を集計してデバッグ出力する関数
            const summarizeMaterials = (root) => {
                let textured = 0;
                let total = 0;
                const debug = [];
                root.traverse((object) => {
                    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
                    total += materials.length;
                    textured += materials.filter((material) => material?.map || material?.emissiveMap || material?.normalMap || material?.metalnessMap || material?.roughnessMap).length;
                    for (const material of materials) {
                        debug.push(`${material?.name ?? '(unnamed)'}|${material?.type ?? '(no-type)'}|map=${Boolean(material?.map)}|emi=${Boolean(material?.emissiveMap)}|nrm=${Boolean(material?.normalMap)}|alpha=${Boolean(material?.alphaMap)}`);
                    }
                });
                return { total, textured, debug };
            };

            // 最適化前のマテリアル情報を記録する
            const beforeOptimize = summarizeMaterials(currentVrm.scene);

            // 不要な頂点を削除して描画負荷を軽減する
            VRMUtils.removeUnnecessaryVertices(currentVrm.scene);

            // スケルトンを統合してボーン計算を最適化する
            VRMUtils.combineSkeletons(currentVrm.scene);

            // 最適化後のマテリアル情報を記録する
            const afterOptimize = summarizeMaterials(currentVrm.scene);

            // モデルを正面に向けるために Y 軸周りに 180 度回転させる
            currentVrm.scene.rotation.y = Math.PI;

            // モデルのバウンディングボックスからサイズと中心を計算する
            const box = new THREE.Box3().setFromObject(currentVrm.scene);
            const size = new THREE.Vector3();
            const center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);
            framing = {
                sizeX: size.x,
                sizeY: size.y,
                sizeZ: size.z,
                centerX: center.x,
                centerY: center.y,
                centerZ: center.z,
            };

            // モデルの中心をシーンの原点に合わせる
            currentVrm.scene.position.set(-framing.centerX, -framing.centerY, -framing.centerZ);

            // マテリアル情報をデバッグログに出力する
            appendLog('Debug', `before optimize materials=${beforeOptimize.total} textured=${beforeOptimize.textured}`);
            appendLog('Debug', beforeOptimize.debug.slice(0, 12).join(' ; '));
            appendLog('Debug', `after optimize materials=${afterOptimize.total} textured=${afterOptimize.textured}`);
            appendLog('Debug', afterOptimize.debug.slice(0, 12).join(' ; '));

            // シーンにモデルを追加してカメラ位置を調整する
            scene.add(currentVrm.scene);
            frameCurrentVrm();
            appendLog('System', 'VRM loaded');
            report('VRM loaded');
        },
        undefined,
        (error) => {
            // VRM の読み込みに失敗した場合のエラーハンドリング
            console.error('[VRM] failed to load', error);
            appendLog('System', `VRM load failed: ${error?.message ?? error}`);
            report(`VRM load failed`);
        },
    );
}

// ---- レンダーループ ----

// アニメーションの時間管理用クロック
const clock = new THREE.Clock();

// メインのアニメーションループ
function animate() {
    requestAnimationFrame(animate);
    resizeRenderer();
    const delta = clock.getDelta();

    // VRM の SpringBone 物理演算と表情更新を行う
    // (毎フレーム呼び出さないと物理演算が停止する)
    if (currentVrm) currentVrm.update(delta);
    renderer.render(scene, camera);
}
animate();

// ---- 表情制御ユーティリティ ----

// VRM モデルの表情（BlendShape）を変更する
function setExpression(name, weight) {
    if (!currentVrm?.expressionManager) return;
    currentVrm.expressionManager.setValue(name, weight);
}

// ---- チャットUI ----

// 会話ログにメッセージを追加して自動スクロールする
function appendLog(who, text) {
    const p = document.createElement('p');
    p.textContent = `[${who}] ${text}`;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
}

// 入力されたメッセージを送信して AI 応答を待つ
async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendLog('You', text);

    // メインプロセスにメッセージを送信して応答を受け取る
    const resp = await window.companion.sendMessage(text);
    if (resp?.text) appendLog('AI', resp.text);
    if (resp?.emotion) setExpression(resp.emotion, resp.intensity ?? 1.0);
}

// 送信ボタンのクリックイベントを設定する
btn.addEventListener('click', sendMessage);

// Enter キーでメッセージを送信できるようにする
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

// メインプロセスからの AI 応答を受け取るリスナー
window.companion.onResponse((data) => {
    if (data?.text) appendLog('AI', data.text);
    if (data?.emotion) setExpression(data.emotion, data.intensity ?? 1.0);
});

// ---- 初期VRMロード (モデルがあれば) ----
// 相対パスから VRM モデルを読み込む
loadVrm(new URL('../assets/models/model.vrm', import.meta.url).href);
