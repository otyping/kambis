/**
 * three-bg.js — ฉากหลัง Three.js
 *
 * ฝุ่นละอองลอย + ดวงแสงนุ่ม 3 ดวงในโทนสีแบรนด์ ขยับตามเมาส์และการเลื่อนหน้า
 *
 * ข้อกำหนดด้านประสิทธิภาพและการเข้าถึง:
 *   - เคารพ prefers-reduced-motion — ไม่สร้างฉากเลย ใช้ gradient นิ่งจาก base.css แทน
 *   - WebGL ใช้ไม่ได้ → เงียบ ๆ ถอยไปใช้ gradient เช่นกัน
 *   - จำกัด devicePixelRatio ที่ 2 และลดจำนวนอนุภาคลงครึ่งบนจอเล็ก
 *   - หยุด render เมื่อสลับแท็บออก (visibilitychange)
 */

/**
 * อ่านสีของฉากหลังจาก CSS custom property เพื่อให้เปลี่ยนตามโหมดสว่าง/มืด
 * โดยไม่ต้องมีตารางสีซ้ำอยู่ในไฟล์นี้
 */
function themeColors() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    orb1: read('--bg-orb-1', '#306d29'),
    orb2: read('--bg-orb-2', '#b3aa55'),
    orb3: read('--bg-orb-3', '#0d530e'),
    dustOpacity: Number(read('--bg-dust-opacity', '0.5')) || 0.5,
  };
}

let cleanup = null;

/** สร้าง texture จุดกลมนุ่มด้วย canvas — ไม่ต้องโหลดไฟล์ภาพจากภายนอก */
function makeDotTexture(THREE) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.72)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** เริ่มฉากหลัง — คืน true ถ้าสร้างสำเร็จ */
export async function initBackground(canvas) {
  if (!canvas) return false;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return false;

  // ตรวจว่า WebGL ใช้ได้จริงก่อนโหลดไลบรารีขนาด 600KB
  try {
    const probe = document.createElement('canvas');
    const ctx = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!ctx) return false;
  } catch {
    return false;
  }

  let THREE;
  try {
    THREE = await import('../../vendor/three.module.min.js');
  } catch {
    return false;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.z = 34;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'low-power',
    });
  } catch {
    return false;
  }

  renderer.setClearColor(0x000000, 0);

  const isSmall = window.innerWidth < 768;
  const particleCount = isSmall ? 340 : 720;

  // ── ฝุ่นละออง ──
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const speeds = new Float32Array(particleCount);

  const theme = themeColors();
  const c1 = new THREE.Color(theme.orb2);
  const c2 = new THREE.Color(theme.orb1);
  const c3 = new THREE.Color(theme.orb3);
  const tint = new THREE.Color();

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 92;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 62;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 46;

    // สุ่มโทนสีจาก 3 สีของธีม โดยให้สีเน้นเด่นที่สุด
    const roll = Math.random();
    tint.copy(roll < 0.5 ? c1 : roll < 0.8 ? c2 : c3);
    tint.multiplyScalar(0.45 + Math.random() * 0.55);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;

    speeds[i] = 0.006 + Math.random() * 0.026;
  }

  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  dustGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const dustMat = new THREE.PointsMaterial({
    size: isSmall ? 0.42 : 0.34,
    // ถ้าไม่ใส่ texture จุดจะเป็นสี่เหลี่ยมทึบ ดูเป็นเม็ดพิกเซล ไม่ใช่ละออง
    map: makeDotTexture(THREE),
    alphaTest: 0.02,
    vertexColors: true,
    transparent: true,
    opacity: theme.dustOpacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // ── ดวงแสงนุ่ม ──
  const orbSpecs = [
    { color: theme.orb2, radius: 16, pos: [-26, 12, -22], opacity: 0.11 },
    { color: theme.orb1, radius: 21, pos: [28, -8, -30], opacity: 0.16 },
    { color: theme.orb3, radius: 13, pos: [6, -20, -18], opacity: 0.07 },
  ];

  const orbs = orbSpecs.map((spec) => {
    const geo = new THREE.SphereGeometry(spec.radius, 24, 18);
    const mat = new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: spec.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...spec.pos);
    scene.add(mesh);
    return { mesh, base: [...spec.pos] };
  });

  // ── การขยับตามผู้ใช้ ──
  const pointer = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let scrollNorm = 0;

  const onPointerMove = (e) => {
    target.x = (e.clientX / window.innerWidth - 0.5) * 2;
    target.y = (e.clientY / window.innerHeight - 0.5) * 2;
  };

  const onScroll = () => {
    const max = Math.max(1, document.body.scrollHeight - window.innerHeight);
    scrollNorm = Math.min(1, window.scrollY / max);
  };

  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  onResize();
  onScroll();

  // ── ลูปวาดภาพ ──
  let frame = 0;
  let running = true;
  let clock = 0;

  const render = () => {
    if (!running) return;
    frame = requestAnimationFrame(render);
    clock += 0.006;

    // ตามเมาส์แบบหน่วง ให้รู้สึกนุ่ม
    pointer.x += (target.x - pointer.x) * 0.035;
    pointer.y += (target.y - pointer.y) * 0.035;

    // ฝุ่นลอยขึ้นช้า ๆ แล้ววนกลับลงมาเมื่อพ้นขอบบน
    const pos = dustGeo.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      pos[i * 3 + 1] += speeds[i];
      if (pos[i * 3 + 1] > 31) {
        pos[i * 3 + 1] = -31;
        pos[i * 3] = (Math.random() - 0.5) * 92;
      }
    }
    dustGeo.attributes.position.needsUpdate = true;

    dust.rotation.y = clock * 0.045 + pointer.x * 0.09;
    dust.rotation.x = pointer.y * 0.05;

    orbs.forEach((orb, i) => {
      const phase = clock + i * 2.1;
      orb.mesh.position.x = orb.base[0] + Math.sin(phase * 0.5) * 3.2 + pointer.x * -2.6;
      orb.mesh.position.y = orb.base[1] + Math.cos(phase * 0.42) * 2.6 + pointer.y * -2 - scrollNorm * 9;
    });

    camera.position.x = pointer.x * 1.7;
    camera.position.y = -pointer.y * 1.3 - scrollNorm * 3.4;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  };

  const onVisibility = () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(frame);
    } else if (!running) {
      running = true;
      render();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  render();

  cleanup = () => {
    running = false;
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    dustGeo.dispose();
    dustMat.map?.dispose();
    dustMat.dispose();
    orbs.forEach((o) => {
      o.mesh.geometry.dispose();
      o.mesh.material.dispose();
    });
    renderer.dispose();
  };

  return true;
}

export function disposeBackground() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
}

/**
 * สร้างฉากหลังใหม่ด้วยสีของธีมปัจจุบัน
 * เรียกตอนผู้ใช้สลับโหมดสว่าง/มืด — ถูกกว่าการไล่เปลี่ยนสีทีละวัตถุ
 * และรับประกันว่าทุกอย่างตรงกับ CSS custom property ชุดใหม่
 */
export async function refreshBackground(canvas) {
  disposeBackground();
  return initBackground(canvas);
}
