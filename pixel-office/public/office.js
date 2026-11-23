// Pixel Office — cảnh văn phòng vẽ bằng canvas (pixel art tự sinh, không dùng asset ngoài).
// Toạ độ logic 400×240, phóng to nguyên lần bằng CSS (image-rendering: pixelated).

export const W = 400;
export const H = 240;
const WALL_H = 40;
const AISLE_Y = 129;
const GLASS_X = 258;
const DOOR = [112, 146];

// ---------- bảng màu ----------
const P = {
  floorA: "#c9b28c", floorB: "#bfa67e", floorLine: "#ad946c",
  carpet: "#5b6c8f", carpetB: "#53638a",
  lounge: "#7a9e7e", loungeB: "#71957a",
  wall: "#3d3a4f", wallTop: "#2b2838", wallTrim: "#54506b",
  desk: "#8b5e3c", deskTop: "#a87449", deskEdge: "#6e4529",
  chair: "#2f3545", chairB: "#3d4558",
  laptop: "#d7dbe3", laptopB: "#9aa1ae", glowWork: "#7cf29a", glowIdle: "#3b4252",
  glass: "rgba(173, 216, 230, 0.28)", glassEdge: "#9fc7d6",
  table: "#6b4a31", tableTop: "#8d6443",
  sofa: "#b24c4c", sofaB: "#943b3b",
  plant: "#3f8f4f", plantB: "#2f6f3c", pot: "#b4653d",
  white: "#f4f4f4", ink: "#1d1d26", skin: "#f2c7a5", skinB: "#d9a982",
};

export const LOOKS = {
  boss: { hair: "#22202a", shirt: "#2b3a67", shirtB: "#22305a", accent: "#d64045", pants: "#23232f", hairStyle: "short" },
  pm: { hair: "#6b3f22", shirt: "#2f9e6e", shirtB: "#25835a", accent: "#e9f5ee", pants: "#3a3f55", hairStyle: "short", glasses: true },
  hunter: { hair: "#c1502e", shirt: "#f08a24", shirtB: "#d4731a", accent: "#ffd166", pants: "#334", hairStyle: "cap", cap: "#264653" },
  marketer: { hair: "#5a2d1a", shirt: "#e85d9a", shirtB: "#c94a82", accent: "#fff", pants: "#2d2d3a", hairStyle: "long" },
  designer: { hair: "#e3c16f", shirt: "#2a9d8f", shirtB: "#21867a", accent: "#fff", pants: "#3a3a48", hairStyle: "short" },
  dev: { hair: "#1b1b1b", shirt: "#6c757d", shirtB: "#5a6268", accent: "#adb5bd", pants: "#2b2b35", hairStyle: "messy" },
  qa: { hair: "#3b2a1a", shirt: "#7b5ea7", shirtB: "#684d90", accent: "#fff", pants: "#2b2b35", hairStyle: "long" },
  staff: { hair: "#2e2e2e", shirt: "#3a86ff", shirtB: "#2f6fd6", accent: "#fff", pants: "#2b2b35", hairStyle: "short" },
  assistant: { hair: "#2b1d14", shirt: "#14b8a6", shirtB: "#0f9488", accent: "#fff", pants: "#30304a", hairStyle: "long", glasses: true },
};

// ---------- tiện ích vẽ ----------
const R = (ctx, x, y, w, h, c) => {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

// Nhân vật ~12×22 px, neo tại chân (x, y).
export function drawCharacter(ctx, x, y, look, o = {}) {
  const { dir = "down", pose = "stand", frame = 0, typing = false, sleep = false, dim = false } = o;
  x = Math.round(x);
  y = Math.round(y);
  ctx.save();
  if (dim) ctx.globalAlpha = 0.55;

  const sit = pose === "sit";
  const step = pose === "walk" ? (frame % 2 === 0 ? 1 : -1) : 0;
  const bob = pose === "walk" && frame % 2 === 0 ? -1 : 0;
  const top = y - 22 + bob + (sit ? 3 : 0);

  // bóng
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(x - 5, y - 1, 10, 2);

  // chân
  if (!sit) {
    R(ctx, x - 4, top + 15, 3, 5 + (step > 0 ? 1 : 0), look.pants);
    R(ctx, x + 1, top + 15, 3, 5 + (step < 0 ? 1 : 0), look.pants);
    R(ctx, x - 4, top + 20 + (step > 0 ? 1 : 0), 3, 1, P.ink);
    R(ctx, x + 1, top + 20 + (step < 0 ? 1 : 0), 3, 1, P.ink);
  } else {
    R(ctx, x - 4, top + 15, 8, 3, look.pants);
  }

  // thân
  R(ctx, x - 5, top + 8, 10, 8, look.shirt);
  R(ctx, x - 5, top + 14, 10, 2, look.shirtB);
  if (dir === "down") {
    if (look === LOOKS.boss) R(ctx, x - 1, top + 9, 2, 5, look.accent); // cà vạt
    else R(ctx, x - 2, top + 8, 4, 1, look.accent); // cổ áo
  }

  // tay
  const armY = top + 9;
  if (typing && sit) {
    const t = frame % 2;
    R(ctx, x - 7, armY + 2, 2, 4, look.shirtB);
    R(ctx, x + 5, armY + 2, 2, 4, look.shirtB);
    R(ctx, x - 6 + t, armY + 6, 3, 2, P.skin);
    R(ctx, x + 3 - t, armY + 6, 3, 2, P.skin);
  } else {
    const a = pose === "walk" ? step : 0;
    R(ctx, x - 7, armY + a, 2, 6, look.shirtB);
    R(ctx, x + 5, armY - a, 2, 6, look.shirtB);
    R(ctx, x - 7, armY + 6 + a, 2, 1, P.skin);
    R(ctx, x + 5, armY + 6 - a, 2, 1, P.skin);
  }

  // đầu
  const hy = sleep ? top + 2 : top;
  R(ctx, x - 4, hy, 8, 8, P.skin);
  R(ctx, x - 4, hy + 7, 8, 1, P.skinB);
  if (dir === "down") {
    if (sleep) {
      R(ctx, x - 3, hy + 4, 2, 1, P.ink);
      R(ctx, x + 1, hy + 4, 2, 1, P.ink);
    } else {
      R(ctx, x - 3, hy + 3, 1, 2, P.ink);
      R(ctx, x + 2, hy + 3, 1, 2, P.ink);
      R(ctx, x - 1, hy + 6, 2, 1, P.skinB);
    }
    if (look.glasses) {
      R(ctx, x - 4, hy + 3, 3, 1, "#222");
      R(ctx, x + 1, hy + 3, 3, 1, "#222");
    }
  }

  // tóc
  const h = look.hair;
  if (look.hairStyle === "cap") {
    R(ctx, x - 5, hy - 2, 10, 3, look.cap);
    if (dir === "down") R(ctx, x - 5, hy + 1, 11, 1, look.cap);
    R(ctx, x - 4, hy + 1, 1, 3, h);
    R(ctx, x + 3, hy + 1, 1, 3, h);
  } else {
    R(ctx, x - 4, hy - 1, 8, 2, h);
    R(ctx, x - 5, hy, 1, 4, h);
    R(ctx, x + 4, hy, 1, 4, h);
    if (dir === "up") R(ctx, x - 4, hy, 8, 6, h);
    if (look.hairStyle === "long") {
      R(ctx, x - 5, hy + 4, 1, 6, h);
      R(ctx, x + 4, hy + 4, 1, 6, h);
      if (dir === "up") R(ctx, x - 4, hy + 6, 8, 4, h);
    }
    if (look.hairStyle === "messy") {
      R(ctx, x - 3, hy - 2, 2, 1, h);
      R(ctx, x + 1, hy - 2, 2, 1, h);
    }
  }
  ctx.restore();
}

// ---------- bố cục ----------
export function layout(n) {
  const cols = 4;
  const desks = [];
  // ≤ 8 người: 2 hàng bàn; 9–12 người: 3 hàng (hàng giữa nằm dưới lối đi).
  const rowsY = n > 8 ? [62, 150, 202] : [62, 168];
  const colX = [36, 92, 148, 204];
  for (let i = 0; i < Math.max(n, 8); i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const y = rowsY[r] ?? 62 + r * 53;
    desks.push({ x: colX[c], y, seat: { x: colX[c], y: y + 4 } });
  }
  const table = { x: 330, y: 74, w: 76, h: 18 };
  // Xếp xen kẽ hàng trên / hàng dưới để nhãn tên không đè nhau.
  const meetSeats = [
    { x: 330, y: 72, dir: "down" }, { x: 305, y: 104, dir: "up" }, { x: 355, y: 104, dir: "up" },
    { x: 305, y: 72, dir: "down" }, { x: 355, y: 72, dir: "down" }, { x: 330, y: 104, dir: "up" },
    { x: 286, y: 88, dir: "down" }, { x: 376, y: 88, dir: "down" },
  ];
  const lounge = [
    { x: 292, y: 210, dir: "down", pose: "sit" }, { x: 372, y: 178, dir: "down", pose: "stand" },
    { x: 322, y: 210, dir: "down", pose: "sit" }, { x: 284, y: 178, dir: "down", pose: "stand" },
    { x: 360, y: 226, dir: "down", pose: "stand" }, { x: 328, y: 176, dir: "down", pose: "stand" },
    { x: 307, y: 210, dir: "down", pose: "sit" }, { x: 388, y: 226, dir: "down", pose: "stand" },
  ];
  return { desks, table, meetSeats, lounge };
}

// ---------- cảnh nền ----------
function skyColors(hour) {
  if (hour >= 6 && hour < 17) return ["#8ecae6", "#bde0fe", false];
  if (hour >= 17 && hour < 19) return ["#f4a261", "#e76f51", false];
  if (hour >= 5 && hour < 6) return ["#9d8ec7", "#f2b5a7", false];
  return ["#1d2b53", "#2a3b6e", true];
}

export function drawRoom(ctx, L, t, meeting) {
  // sàn
  for (let y = WALL_H; y < H; y += 8)
    for (let x = 0; x < GLASS_X; x += 16) R(ctx, x + ((y / 8) % 2 ? 8 : 0), y, 16, 8, ((x + y) / 8) % 2 ? P.floorA : P.floorB);
  for (let y = WALL_H; y < H; y += 8) R(ctx, 0, y, GLASS_X, 1, P.floorLine);
  for (let y = WALL_H; y < DOOR[0]; y += 6) for (let x = GLASS_X; x < W; x += 6) R(ctx, x, y, 6, 6, ((x + y) / 6) % 2 ? P.carpet : P.carpetB);
  for (let y = DOOR[0]; y < H; y += 6) for (let x = GLASS_X; x < W; x += 6) R(ctx, x, y, 6, 6, ((x + y) / 6) % 2 ? P.lounge : P.loungeB);
  // lối đi
  R(ctx, 0, AISLE_Y - 9, GLASS_X, 18, "rgba(255,255,255,0.08)");

  // tường
  R(ctx, 0, 0, W, WALL_H, P.wall);
  R(ctx, 0, 0, W, 4, P.wallTop);
  R(ctx, 0, WALL_H - 3, W, 3, P.wallTrim);

  // cửa sổ (trời theo giờ thật)
  const now = new Date();
  const [s1, s2, night] = skyColors(now.getHours());
  for (const wx of [16, 84, 152]) {
    R(ctx, wx - 2, 8, 52, 24, P.wallTrim);
    const g = ctx.createLinearGradient(0, 10, 0, 30);
    g.addColorStop(0, s1);
    g.addColorStop(1, s2);
    ctx.fillStyle = g;
    ctx.fillRect(wx, 10, 48, 20);
    if (night) {
      for (let i = 0; i < 6; i++) R(ctx, wx + ((i * 17 + wx) % 46) + 1, 12 + ((i * 7) % 14), 1, 1, (Math.floor(t / 700) + i) % 3 ? "#fff" : "#ffe066");
    } else {
      const cx0 = wx + ((t / 400 + wx) % 48);
      R(ctx, cx0, 14, Math.max(0, Math.min(10, wx + 48 - cx0)), 3, "rgba(255,255,255,0.8)");
    }
    R(ctx, wx + 23, 10, 2, 20, P.wallTrim);
    R(ctx, wx, 19, 48, 2, P.wallTrim);
  }

  // đồng hồ treo tường (giờ thật)
  const cx = 230, cy = 20;
  R(ctx, cx - 8, cy - 8, 16, 16, P.wallTrim);
  R(ctx, cx - 7, cy - 7, 14, 14, P.white);
  for (const [dx, dy] of [[0, -6], [6, 0], [0, 6], [-6, 0]]) R(ctx, cx + dx, cy + dy, 1, 1, P.ink);
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 1;
  const hand = (ang, len) => {
    ctx.beginPath();
    ctx.moveTo(cx + 0.5, cy + 0.5);
    ctx.lineTo(cx + 0.5 + Math.sin(ang) * len, cy + 0.5 - Math.cos(ang) * len);
    ctx.stroke();
  };
  hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 3.5);
  hand(now.getMinutes() * (Math.PI / 30), 5.5);

  // tường kính phòng họp / phòng nghỉ
  R(ctx, GLASS_X, WALL_H, 2, DOOR[0] - WALL_H, P.glassEdge);
  R(ctx, GLASS_X, DOOR[1], 2, H - DOOR[1], P.glassEdge);
  R(ctx, GLASS_X, DOOR[0] - 1, W - GLASS_X, 2, P.glassEdge);
  R(ctx, GLASS_X + 2, WALL_H, 3, DOOR[0] - WALL_H, P.glass);

  // bảng trắng phòng họp
  R(ctx, 296, 8, 70, 26, "#9aa0ab");
  R(ctx, 298, 10, 66, 22, P.white);
  if (meeting) {
    for (let i = 0; i < 4; i++) R(ctx, 302, 13 + i * 4, 20 + ((i * 13) % 34), 1, i === 0 ? "#d64045" : "#3a86ff");
    R(ctx, 346, 22, 12, 6, "#2f9e6e");
    R(ctx, 349, 18, 3, 10, "#2f9e6e");
  }

  // máy pha cà phê + bình nước + kệ
  R(ctx, 376, 152, 16, 18, "#2b2b35");
  R(ctx, 378, 155, 12, 5, "#4b4b5a");
  R(ctx, 382, 162, 4, 4, P.white);
  if (Math.floor(t / 400) % 2) R(ctx, 383, 148, 1, 3, "rgba(255,255,255,0.6)");
  else R(ctx, 384, 147, 1, 3, "rgba(255,255,255,0.6)");
  R(ctx, 266, 150, 10, 20, "#c4e3f3");
  R(ctx, 266, 166, 10, 6, "#7aa7c7");

  // cây
  for (const [px, py] of [[6, 52], [246, 52], [6, 220], [392, 120]]) {
    R(ctx, px - 4, py + 2, 8, 7, P.pot);
    R(ctx, px - 6, py - 8, 12, 10, P.plant);
    R(ctx, px - 3, py - 12, 6, 6, P.plantB);
    R(ctx, px - 7, py - 4, 3, 3, P.plantB);
  }
}

// Vật thể có chiều sâu (vẽ theo thứ tự y cùng nhân vật)
export function sceneProps(L, deskStates) {
  const props = [];
  L.desks.forEach((d, i) => {
    const st = deskStates[i];
    // ghế (sau nhân vật)
    props.push({ y: d.y + 3, draw: (ctx) => { R(ctx, d.x - 6, d.y - 10, 12, 12, P.chair); R(ctx, d.x - 5, d.y - 9, 10, 4, P.chairB); } , behind: true });
    props.push({
      y: d.y + 22,
      draw: (ctx, t) => {
        R(ctx, d.x - 22, d.y + 4, 44, 6, P.deskTop);
        R(ctx, d.x - 22, d.y + 10, 44, 10, P.desk);
        R(ctx, d.x - 22, d.y + 20, 3, 4, P.deskEdge);
        R(ctx, d.x + 19, d.y + 20, 3, 4, P.deskEdge);
        R(ctx, d.x - 22, d.y + 4, 44, 1, "#c08a5a");
        // laptop (mặt sau quay về phía người xem)
        R(ctx, d.x - 8, d.y - 3, 16, 9, P.laptopB);
        R(ctx, d.x - 7, d.y - 2, 14, 7, P.laptop);
        const on = st && st !== "empty" && st !== "paused";
        const glow = st === "working" || st === "writing" || st === "researching";
        R(ctx, d.x - 1, d.y, 2, 2, glow ? (Math.floor(t / 300) % 2 ? P.glowWork : "#5fd27d") : on ? "#8fa3bf" : P.glowIdle);
        // cốc + giấy
        if (st && st !== "empty") {
          R(ctx, d.x + 12, d.y + 2, 4, 4, P.white);
          R(ctx, d.x - 18, d.y + 3, 6, 3, "#e9ecef");
        }
      },
    });
  });
  // bàn họp
  const tb = L.table;
  props.push({
    y: tb.y + tb.h + 6,
    draw: (ctx) => {
      R(ctx, tb.x - tb.w / 2, tb.y, tb.w, tb.h, P.tableTop);
      R(ctx, tb.x - tb.w / 2, tb.y + tb.h, tb.w, 5, P.table);
      R(ctx, tb.x - tb.w / 2 + 2, tb.y + 2, tb.w - 4, 1, "#a77a54");
      R(ctx, tb.x - 6, tb.y + 6, 12, 6, "#2b2b35");
      R(ctx, tb.x - 5, tb.y + 7, 10, 4, "#7cf29a");
    },
  });
  // sofa: lưng ghế (sau người ngồi) + mặt ghế (trước)
  props.push({ y: 200, draw: (ctx) => R(ctx, 280, 192, 52, 12, P.sofaB) });
  props.push({
    y: 222,
    draw: (ctx) => {
      R(ctx, 280, 210, 52, 10, P.sofa);
      R(ctx, 280, 210, 52, 1, "#c96262");
      R(ctx, 278, 202, 4, 18, P.sofaB);
      R(ctx, 330, 202, 4, 18, P.sofaB);
    },
  });
  return props;
}

// ---------- hiệu ứng trên đầu ----------
export function drawEmote(ctx, x, y, kind, t) {
  const blink = Math.floor(t / 400) % 2;
  if (kind === "sleep") {
    ctx.fillStyle = "#cfd8ff";
    const k = Math.floor(t / 600) % 3;
    for (let i = 0; i <= k; i++) R(ctx, x + 4 + i * 3, y - 28 - i * 4, 3, 1, "#cfd8ff"), R(ctx, x + 6 + i * 3, y - 29 - i * 4, 1, 1, "#cfd8ff");
  } else if (kind === "error" && blink) {
    R(ctx, x - 1, y - 34, 3, 7, "#ff4d4d");
    R(ctx, x - 1, y - 25, 3, 2, "#ff4d4d");
  } else if (kind === "waiting") {
    for (let i = 0; i < 3; i++) if (Math.floor(t / 350) % 4 > i) R(ctx, x - 4 + i * 3, y - 28, 2, 2, "#ffffff");
  } else if (kind === "coffee") {
    R(ctx, x + 6, y - 12, 3, 3, P.white);
    if (blink) R(ctx, x + 7, y - 15, 1, 2, "rgba(255,255,255,0.7)");
  }
}

// ---------- di chuyển ----------
export function planPath(from, to) {
  const pts = [];
  const inRight = (p) => p.x > GLASS_X;
  const same = Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1;
  if (same) return pts;
  pts.push({ x: from.x, y: AISLE_Y });
  if (inRight(from) !== inRight(to)) {
    pts.push({ x: GLASS_X + (inRight(to) ? 14 : -14), y: AISLE_Y });
  }
  pts.push({ x: to.x, y: AISLE_Y });
  pts.push({ x: to.x, y: to.y });
  return pts;
}

export const geometry = { W, H, AISLE_Y, GLASS_X };
