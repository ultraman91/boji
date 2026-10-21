// 动作分析的纯计算部分：关节角度、动作次数切分、各动作的判断规则。
// 不碰页面，方便单独测试。坐标是像素（已经乘过视频宽高），y 轴向下。
// 阈值都是二维视频下的参考值，误差大约 ±5–10°，用来发现明显的问题，不当成精确测量。

export const SIDE = {
  left:  {ear:7, sh:11, el:13, wr:15, hip:23, kn:25, an:27, heel:29, toe:31},
  right: {ear:8, sh:12, el:14, wr:16, hip:24, kn:26, an:28, heel:30, toe:32}
};
const NOSE = 0, VIS = 0.5;

export const EXERCISES = {
  squat:  {name:'深蹲（哈克 / 史密斯 / 高脚杯）', view:'侧面', film:'侧面拍：手机固定在髋部高度（放凳子或水瓶上），镜头正对身体侧面，离 3–4 米，从头到脚都在画面里。一段视频拍一组。'},
  rdl:    {name:'罗马尼亚硬拉 / 髋铰链', view:'侧面', film:'侧面拍：手机固定在髋部高度，镜头正对身体侧面，离 3–4 米，从头到脚都在画面里。'},
  thrust: {name:'臀推 / 臀桥', view:'侧面', film:'侧面拍：手机放低一点（凳子高度），镜头正对身体侧面，肩、髋、膝、脚都在画面里。'},
  row:    {name:'划船（坐姿 / 单臂）', view:'侧面', film:'侧面拍：镜头正对身体侧面，头、肩、手肘、手腕、髋都在画面里。'},
  raise:  {name:'侧平举', view:'正面', film:'正面拍：手机在胸口高度，正对身体，离 2–3 米，上半身和髋都在画面里。用后置摄像头或请别人拍，自拍会左右颠倒。'},
  plank:  {name:'平板支撑', view:'侧面', film:'侧面拍：手机放在离地不高的位置，镜头正对身体侧面，从头到脚都在画面里。'},
  postureSide:  {name:'体态：侧面站姿照片', view:'侧面', photo:true, film:'侧面照：放松自然站，别刻意挺。手机在腰部高度，正对身体侧面，离 3 米，从头到脚都在画面里，最好穿贴身的衣服。'},
  postureFront: {name:'体态：正面站姿照片', view:'正面', photo:true, film:'正面照：放松自然站，手机在胸口高度正对身体，离 3 米，从头到脚都在画面里。用后置摄像头或请别人拍，自拍会左右颠倒。'}
};

/* ---------- geometry ---------- */
export function toPx(lm, W, H){ return lm.map(p => ({x:p.x*W, y:p.y*H, v: p.visibility == null ? 1 : p.visibility})); }
export const dist = (a, b) => Math.hypot(a.x-b.x, a.y-b.y);
export function angle(a, b, c){
  const ux = a.x-b.x, uy = a.y-b.y, wx = c.x-b.x, wy = c.y-b.y;
  const d = Math.hypot(ux, uy) * Math.hypot(wx, wy);
  if (!d) return null;
  return Math.acos(Math.max(-1, Math.min(1, (ux*wx + uy*wy) / d))) * 180 / Math.PI;
}
// q 相对 p 偏离竖直向上的角度；fwd=+1 表示 x 变大的方向是身体前方。往前为正。
export function lean(p, q, fwd){ return Math.atan2((q.x-p.x)*fwd, p.y-q.y) * 180 / Math.PI; }
// 大腿和地面的夹角：0 = 平行；正数 = 髋还在膝盖上方；负数 = 蹲到平行以下
export function thighAngle(hip, kn){ return Math.atan2(kn.y-hip.y, Math.abs(kn.x-hip.x)) * 180 / Math.PI; }
// 点 p 到直线 a-b 的距离（除以 a-b 长度）；正 = p 在直线下方（画面里更低）
export function offsetBelow(p, a, b){
  const dx = b.x-a.x, dy = b.y-a.y, len2 = dx*dx + dy*dy;
  if (!len2) return 0;
  const t = ((p.x-a.x)*dx + (p.y-a.y)*dy) / len2;
  const px = a.x + t*dx, py = a.y + t*dy, d = Math.hypot(p.x-px, p.y-py) / Math.sqrt(len2);
  return p.y >= py ? d : -d;
}

/* ---------- series helpers ---------- */
export function median(a){ const v = a.filter(x => x != null && !isNaN(x)).sort((x,y) => x-y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m-1] + v[m]) / 2; }
export function pct(a, p){ const v = a.filter(x => x != null).sort((x,y) => x-y); if (!v.length) return null; return v[Math.min(v.length-1, Math.max(0, Math.round((p/100) * (v.length-1))))]; }
export function smooth(a){
  const m = a.map((v, i) => { if (v == null) return null; const w = [a[i-1], v, a[i+1]].filter(x => x != null).sort((x,y) => x-y); return w[w.length >> 1]; });
  return m.map((v, i) => { if (v == null) return null; const w = [m[i-1], v, m[i+1]].filter(x => x != null); return w.reduce((s,x) => s+x, 0) / w.length; });
}
const ok = (p, idx) => !!p && idx.every(i => p[i] && p[i].v >= VIS);
function series(frames, idx, fn){ return smooth(frames.map(f => ok(f.p, idx) ? fn(f.p) : null)); }
// 动作次数切分。dir='min'：数值先变小再回来（比如深蹲时膝角）；'max'：先变大再回来（比如臀推时髋角）
export function segment(vals, dir, minRange){
  const s = vals.map(v => v == null ? null : (dir === 'min' ? -v : v));
  const ss = s.filter(v => v != null);
  if (ss.length < 6) return [];
  const rest = pct(ss, 10), peak = pct(ss, 95), range = peak - rest;
  if (range < minRange) return [];
  const enter = rest + range*0.4, exit = rest + range*0.2;
  const reps = []; let cur = null, lastRest = null;
  for (let i = 0; i < s.length; i++){
    const x = s[i]; if (x == null) continue;
    if (!cur){
      if (x <= exit) lastRest = i;
      if (x >= enter) cur = {i0: lastRest == null ? i : lastRest, ie: i};
    } else {
      if (x > s[cur.ie]) cur.ie = i;
      if (x <= exit){ cur.i1 = i; reps.push(cur); cur = null; lastRest = i; }
    }
  }
  if (!reps.length) return reps;
  const ex = reps.map(r => s[r.ie] - rest), med = median(ex);
  const kept = reps.filter((r, k) => ex[k] >= med*0.6);
  // 计时从刚离开静止位置（幅度 5%）算到回到静止位置，下放、起身用时才准
  const lo = rest + range*0.05;
  let prevEnd = 0;
  kept.forEach((r, k) => {
    let a = r.ie; while (a > prevEnd && s[a-1] != null && s[a-1] > lo) a--;
    r.i0 = Math.max(prevEnd, a - 1);
    const lim = k + 1 < kept.length ? kept[k+1].ie : s.length - 1;
    let b = r.ie; while (b < lim && s[b+1] != null && s[b+1] > lo) b++;
    r.i1 = Math.max(r.i1, Math.min(lim, b + 1));
    prevEnd = r.i1;
  });
  return kept;
}
function pickSide(frames){
  let l = 0, r = 0;
  for (const f of frames){ if (!f.p) continue; for (const k of ['sh','el','wr','hip','kn','an']){ l += f.p[SIDE.left[k]].v; r += f.p[SIDE.right[k]].v; } }
  return l >= r ? 'left' : 'right';
}
function forwardOf(frames, S){
  const toes = frames.filter(f => ok(f.p, [S.heel, S.toe])).map(f => f.p[S.toe].x - f.p[S.heel].x);
  if (toes.length >= 3) return median(toes) >= 0 ? 1 : -1;
  const face = frames.filter(f => ok(f.p, [NOSE, S.ear])).map(f => f.p[NOSE].x - f.p[S.ear].x);
  return face.length && median(face) < 0 ? -1 : 1;
}
// 两肩横向距离 ÷ 躯干长度：正侧面约 0–0.25，正面约 0.6–0.9。用来判断拍摄角度对不对
function frontness(p){
  const L = SIDE.left, R = SIDE.right;
  if (!p || ![L.sh, R.sh, L.hip, R.hip].every(i => p[i] && p[i].v >= 0.3)) return null;
  const mid = (a, b) => ({x:(p[a].x + p[b].x)/2, y:(p[a].y + p[b].y)/2});
  const torso = dist(mid(L.sh, R.sh), mid(L.hip, R.hip));
  return torso ? Math.abs(p[L.sh].x - p[R.sh].x) / torso : null;
}
function viewNote(frames, want){
  const f = median(frames.map(x => frontness(x.p)));
  if (f == null) return null;
  if (want === 'side' && f > 0.45) return {lv:'info', t:'这段不是正侧面拍的，数值误差会大一些。下次让镜头正对身体侧面。'};
  if (want === 'front' && f < 0.4) return {lv:'info', t:'这段不像正面拍的，左右对比会不准。下次让镜头正对身体正面。'};
  return null;
}
const at = (arr, i) => arr[i] == null ? null : arr[i];
const r0 = x => x == null ? '–' : String(Math.round(x));
const deg = x => x == null ? '–' : Math.round(x)+'°';
const sec = x => x == null ? '–' : x.toFixed(1)+' 秒';
const pctTxt = x => Math.round(x*100)+'%';
const fail = msg => ({ok:false, msg});
const NO_PERSON = '画面里没认出人。确认全身都在画面里、光线够亮，再按拍摄要求重拍一段。';

/* ---------- 深蹲 ---------- */
function squat(frames){
  const side = pickSide(frames), S = SIDE[side], fwd = forwardOf(frames, S);
  const knee = series(frames, [S.hip, S.kn, S.an], p => angle(p[S.hip], p[S.kn], p[S.an]));
  const reps = segment(knee, 'min', 30);
  if (!reps.length) return fail('没认出完整的下蹲。确认是侧面拍、全身都在画面里，并且至少做了一次完整的蹲起。');
  const thigh = series(frames, [S.hip, S.kn], p => thighAngle(p[S.hip], p[S.kn]));
  const trunk = series(frames, [S.hip, S.sh], p => lean(p[S.hip], p[S.sh], fwd));
  const shin = median(frames.filter(f => ok(f.p, [S.kn, S.an])).map(f => dist(f.p[S.kn], f.p[S.an])));
  const heelRest = median(reps.map(r => ok(frames[r.i0].p, [S.heel]) ? frames[r.i0].p[S.heel].y : null));
  const t = frames.map(f => f.t);
  const rows = reps.map((r, k) => {
    const p = frames[r.ie].p;
    return {n:k+1, ie:r.ie, knee:at(knee, r.ie), thigh:at(thigh, r.ie), trunk:at(trunk, r.ie),
      heel: heelRest != null && shin && ok(p, [S.heel]) ? (heelRest - p[S.heel].y) / shin : null,
      down: t[r.ie]-t[r.i0], up: t[r.i1]-t[r.ie]};
  });
  const F = [], mThigh = median(rows.map(x => x.thigh)), mTrunk = median(rows.map(x => x.trunk)), mDown = median(rows.map(x => x.down));
  if (mThigh != null){
    if (mThigh > 15) F.push({lv:'bad', t:'蹲得不够深：最低点大腿还比水平高约 '+deg(mThigh)+'。至少蹲到大腿和地面平行（0°）。'});
    else if (mThigh > 5) F.push({lv:'warn', t:'差一点到平行：最低点大腿约 '+deg(mThigh)+'，再往下蹲一点。'});
    else F.push({lv:'good', t:'深度够了：最低点大腿约 '+deg(mThigh)+'（0° = 和地面平行，负数 = 低于平行）。'});
    const th = rows.map(x => x.thigh).filter(x => x != null);
    if (th.length >= 3 && Math.max(...th) - Math.min(...th) > 15) F.push({lv:'warn', t:'每次深度不一样，最深和最浅差 '+deg(Math.max(...th) - Math.min(...th))+'。越做越浅说明重量偏重或累了。'});
  }
  if (mTrunk != null){
    if (mTrunk > 50) F.push({lv:'warn', t:'最低点上身前倾约 '+deg(mTrunk)+'，偏多。用器械时脚往前放一点；徒手或高脚杯深蹲可以把脚跟垫高一点，胸口保持朝前。'});
    else F.push({lv:'good', t:'最低点上身前倾约 '+deg(mTrunk)+'，在正常范围。'});
  }
  const lifts = rows.map(x => x.heel).filter(x => x != null), oblique = (median(frames.map(f => frontness(f.p))) ?? 0) > 0.45;
  if (!oblique && lifts.length && median(lifts) > 0.08) F.push({lv:'warn', t:'蹲到底时脚跟好像抬起来了（侧面拍得不正也可能误判，看关键帧确认）。重心放在整个脚掌，脚跟踩实。'});
  if (mDown != null){
    if (mDown < 1.0) F.push({lv:'warn', t:'下蹲太快（约 '+sec(mDown)+'）。下放用 2–3 秒，慢下来更安全，练得也更到位。'});
    else if (mDown < 1.8) F.push({lv:'info', t:'下蹲约 '+sec(mDown)+'，可以再慢一点，到 2 秒左右。'});
    else F.push({lv:'good', t:'下蹲节奏好（约 '+sec(mDown)+'）。'});
  }
  const worst = rows.reduce((a, b) => (b.thigh ?? -99) > (a.thigh ?? -99) ? b : a, rows[0]);
  const keyOf = x => ({i:x.ie, lines:[[S.sh,S.hip],[S.hip,S.kn],[S.kn,S.an],[S.an,S.toe]], hline:S.kn,
    labels:[[S.kn,'膝 '+deg(x.knee)],[S.hip,'大腿 '+deg(x.thigh)],[S.sh,'前倾 '+deg(x.trunk)]]});
  return {ok:true, side, reps:rows, keyRep:worst.n, keys:rows.map(keyOf), findings:F,
    table:{head:['次','大腿角','膝角','上身前倾','下蹲用时'], rows:rows.map(x => [x.n, deg(x.thigh), deg(x.knee), deg(x.trunk), sec(x.down)])},
    metrics:{'大腿角':r0(mThigh)+'°','上身前倾':r0(mTrunk)+'°','下蹲用时':sec(mDown)}};
}

/* ---------- 罗马尼亚硬拉 / 髋铰链 ---------- */
function rdl(frames){
  const side = pickSide(frames), S = SIDE[side], fwd = forwardOf(frames, S);
  const hip = series(frames, [S.sh, S.hip, S.kn], p => angle(p[S.sh], p[S.hip], p[S.kn]));
  const reps = segment(hip, 'min', 30);
  if (!reps.length) return fail('没认出完整的屈髋动作。确认是侧面拍、全身都在画面里，并且至少做了一次完整的下放和起身。');
  const knee = series(frames, [S.hip, S.kn, S.an], p => angle(p[S.hip], p[S.kn], p[S.an]));
  const trunk = series(frames, [S.hip, S.sh], p => lean(p[S.hip], p[S.sh], fwd));
  const head = series(frames, [S.ear, S.sh, S.hip], p => angle(p[S.ear], p[S.sh], p[S.hip]));
  const t = frames.map(f => f.t);
  const rows = reps.map((r, k) => {
    const p = frames[r.ie].p;
    const wrist = ok(p, [S.wr, S.kn, S.hip]) ? Math.abs(p[S.wr].x - p[S.kn].x) / dist(p[S.hip], p[S.kn]) : null;
    return {n:k+1, ie:r.ie, hip:at(hip, r.ie), knee:at(knee, r.ie), trunk:at(trunk, r.ie), head:at(head, r.ie), wrist, down:t[r.ie]-t[r.i0]};
  });
  const F = [], m = key => median(rows.map(x => x[key]));
  const mKnee = m('knee'), mTrunk = m('trunk'), mHead = m('head'), mWrist = m('wrist'), mDown = m('down');
  if (mKnee != null){
    if (mKnee < 125) F.push({lv:'bad', t:'最低点膝盖弯到 '+deg(mKnee)+'，变成深蹲了。膝盖固定在微屈，主要靠屁股往后推。'});
    else if (mKnee < 145) F.push({lv:'warn', t:'膝盖弯得偏多（约 '+deg(mKnee)+'）。膝盖微屈后就别再弯，让屁股往后走。'});
    else F.push({lv:'good', t:'膝盖保持微屈（约 '+deg(mKnee)+'），是髋在发力。'});
  }
  if (mTrunk != null){
    if (mTrunk < 45) F.push({lv:'warn', t:'下得偏浅：上身只前倾约 '+deg(mTrunk)+'。屁股再往后推，直到大腿后侧明显拉紧再起。'});
    else F.push({lv:'good', t:'屈髋幅度够（上身前倾约 '+deg(mTrunk)+'）。'});
  }
  if (mWrist != null && mWrist > 0.35) F.push({lv:'warn', t:'哑铃离腿偏远。让哑铃贴着大腿、小腿往下滑，腰的负担会小很多。'});
  if (mHead != null){
    if (mHead < 145) F.push({lv:'warn', t:'头和上背往下掉了（耳朵、肩、髋夹角约 '+deg(mHead)+'）。眼睛看前下方 1–2 米，后脑勺、上背、屁股保持一条斜线。'});
    else F.push({lv:'good', t:'头和上背基本在一条线上。'});
  }
  if (mDown != null && mDown < 1.2) F.push({lv:'warn', t:'下放太快（约 '+sec(mDown)+'），用 2 秒左右慢慢放下去。'});
  F.push({lv:'info', t:'腰有没有弯，这个工具量不出来。看下面的关键帧自己检查：从后脑勺到屁股应该是一条平直的斜线。'});
  const worst = rows.reduce((a, b) => (b.knee ?? 999) < (a.knee ?? 999) ? b : a, rows[0]);
  const keyOf = x => ({i:x.ie, lines:[[S.ear,S.sh],[S.sh,S.hip],[S.hip,S.kn],[S.kn,S.an],[S.sh,S.el],[S.el,S.wr]],
    labels:[[S.kn,'膝 '+deg(x.knee)],[S.hip,'髋 '+deg(x.hip)],[S.sh,'前倾 '+deg(x.trunk)]]});
  return {ok:true, side, reps:rows, keyRep:worst.n, keys:rows.map(keyOf), findings:F,
    table:{head:['次','膝角','上身前倾','髋角','下放用时'], rows:rows.map(x => [x.n, deg(x.knee), deg(x.trunk), deg(x.hip), sec(x.down)])},
    metrics:{'膝角':r0(mKnee)+'°','上身前倾':r0(mTrunk)+'°'}};
}

/* ---------- 臀推 / 臀桥 ---------- */
function thrust(frames){
  const side = pickSide(frames), S = SIDE[side];
  const ext = series(frames, [S.sh, S.hip, S.kn], p => { const a = angle(p[S.sh], p[S.hip], p[S.kn]); return a == null ? null : (offsetBelow(p[S.hip], p[S.sh], p[S.kn]) < -0.02 ? 360 - a : a); });
  const reps = segment(ext, 'max', 25);
  if (!reps.length) return fail('没认出完整的顶髋动作。确认是侧面拍，肩、髋、膝都在画面里，并且至少顶起放下一次。');
  const knee = series(frames, [S.hip, S.kn, S.an], p => angle(p[S.hip], p[S.kn], p[S.an]));
  const t = frames.map(f => f.t);
  const rows = reps.map((r, k) => {
    let a = r.ie, b = r.ie; const top = ext[r.ie];
    while (a > r.i0 && ext[a-1] != null && ext[a-1] >= top - 6) a--;
    while (b < r.i1 && ext[b+1] != null && ext[b+1] >= top - 6) b++;
    return {n:k+1, ie:r.ie, top, knee:at(knee, r.ie), hold:t[b]-t[a]};
  });
  const F = [], mTop = median(rows.map(x => x.top)), mKnee = median(rows.map(x => x.knee)), mHold = median(rows.map(x => x.hold));
  if (mTop != null){
    if (mTop < 160) F.push({lv:'warn', t:'没顶到一条线（髋约 '+deg(mTop)+'，180° = 肩、髋、膝一条线）。最高点再夹紧屁股往上顶。'});
    else if (mTop > 195) F.push({lv:'warn', t:'顶过头了（髋约 '+deg(mTop)+'），腰在往上拱。顶到肩、髋、膝一条线就停，下巴微收。'});
    else F.push({lv:'good', t:'顶到位了（髋约 '+deg(mTop)+'，180° = 一条线）。'});
  }
  if (mKnee != null){
    if (mKnee > 105) F.push({lv:'warn', t:'脚放得偏远（最高点膝盖约 '+deg(mKnee)+'）。往屁股方向挪近一点，不然大腿后侧会抢活。'});
    else if (mKnee < 75) F.push({lv:'warn', t:'脚放得偏近（最高点膝盖约 '+deg(mKnee)+'）。往前挪一点，让小腿在最高点接近竖直。'});
    else F.push({lv:'good', t:'脚的位置合适（最高点膝盖约 '+deg(mKnee)+'）。'});
  }
  if (mHold != null){
    if (mHold < 0.7) F.push({lv:'warn', t:'最高点只停了约 '+sec(mHold)+'。顶到位后夹紧屁股停 1 秒再放。'});
    else F.push({lv:'good', t:'最高点有停顿（约 '+sec(mHold)+'）。'});
  }
  const worst = rows.reduce((a, b) => Math.abs((b.top ?? 180) - 180) > Math.abs((a.top ?? 180) - 180) ? b : a, rows[0]);
  const keyOf = x => ({i:x.ie, lines:[[S.sh,S.hip],[S.hip,S.kn],[S.kn,S.an]], labels:[[S.hip,'髋 '+deg(x.top)],[S.kn,'膝 '+deg(x.knee)]]});
  return {ok:true, side, reps:rows, keyRep:worst.n, keys:rows.map(keyOf), findings:F,
    table:{head:['次','最高点髋角','膝角','顶峰停留'], rows:rows.map(x => [x.n, deg(x.top), deg(x.knee), sec(x.hold)])},
    metrics:{'髋角':r0(mTop)+'°','膝角':r0(mKnee)+'°','停留':sec(mHold)}};
}

/* ---------- 划船 ---------- */
function row(frames){
  const side = pickSide(frames), S = SIDE[side], fwd = forwardOf(frames, S);
  const elbow = series(frames, [S.sh, S.el, S.wr], p => angle(p[S.sh], p[S.el], p[S.wr]));
  const reps = segment(elbow, 'min', 30);
  if (!reps.length) return fail('没认出完整的拉动作。确认是侧面拍，肩、手肘、手腕都在画面里，并且至少拉了一次完整的来回。');
  const trunk = series(frames, [S.hip, S.sh], p => lean(p[S.hip], p[S.sh], fwd));
  const earSh = series(frames, [S.ear, S.sh], p => dist(p[S.ear], p[S.sh]));
  const t = frames.map(f => f.t);
  const rows = reps.map((r, k) => {
    const tr = trunk.slice(r.i0, r.i1+1).filter(x => x != null);
    const restEar = at(earSh, r.i0), peakEar = at(earSh, r.ie);
    return {n:k+1, ie:r.ie, elbow:at(elbow, r.ie), stretch:Math.max(at(elbow, r.i0) ?? 0, at(elbow, r.i1) ?? 0) || null,
      swing: tr.length ? Math.max(...tr) - Math.min(...tr) : null,
      shrug: restEar && peakEar ? 1 - peakEar / restEar : null, back:t[r.i1]-t[r.ie]};
  });
  const F = [], m = key => median(rows.map(x => x[key]));
  const mSwing = m('swing'), mShrug = m('shrug'), mElbow = m('elbow'), mStretch = m('stretch'), mBack = m('back');
  if (mSwing != null){
    if (mSwing > 15) F.push({lv:'warn', t:'身体前后晃了约 '+deg(mSwing)+'，在借力。重量减一点，上身固定住，只动手臂和肩胛。'});
    else F.push({lv:'good', t:'上身稳（来回晃动约 '+deg(mSwing)+'）。'});
  }
  if (mShrug != null){
    if (mShrug > 0.15) F.push({lv:'warn', t:'拉到底时耸肩了（耳朵和肩膀的距离缩短约 '+pctTxt(mShrug)+'）。先沉肩再拉，想象肩膀离耳朵越远越好。'});
    else F.push({lv:'good', t:'拉的时候没有明显耸肩。'});
  }
  if (mElbow != null){
    if (mElbow > 100) F.push({lv:'warn', t:'没拉到位（手肘最小约 '+deg(mElbow)+'）。手肘再往后拉，拉到身体侧后方。'});
    else F.push({lv:'good', t:'拉到位了（手肘约 '+deg(mElbow)+'）。'});
  }
  if (mStretch != null && mStretch < 150) F.push({lv:'warn', t:'放回去时手臂没伸直（约 '+deg(mStretch)+'）。放到手臂伸直、背部有拉伸感，再拉下一次。'});
  if (mBack != null && mBack < 1.0) F.push({lv:'warn', t:'放回去太快（约 '+sec(mBack)+'），用 2 秒控制住。'});
  const worst = rows.reduce((a, b) => (b.swing ?? 0) + (b.shrug ?? 0)*100 > (a.swing ?? 0) + (a.shrug ?? 0)*100 ? b : a, rows[0]);
  const keyOf = x => ({i:x.ie, lines:[[S.ear,S.sh],[S.sh,S.hip],[S.sh,S.el],[S.el,S.wr]], labels:[[S.el,'肘 '+deg(x.elbow)],[S.sh,'晃 '+deg(x.swing)]]});
  return {ok:true, side, reps:rows, keyRep:worst.n, keys:rows.map(keyOf), findings:F,
    table:{head:['次','手肘最小','上身晃动','耸肩','放回用时'], rows:rows.map(x => [x.n, deg(x.elbow), deg(x.swing), x.shrug == null ? '–' : pctTxt(Math.max(0, x.shrug)), sec(x.back)])},
    metrics:{'晃动':r0(mSwing)+'°','耸肩':mShrug == null ? '–' : pctTxt(Math.max(0, mShrug))}};
}

/* ---------- 侧平举（正面） ---------- */
function raise(frames){
  const L = SIDE.left, R = SIDE.right;
  const abdL = series(frames, [L.hip, L.sh, L.el], p => angle(p[L.hip], p[L.sh], p[L.el]));
  const abdR = series(frames, [R.hip, R.sh, R.el], p => angle(p[R.hip], p[R.sh], p[R.el]));
  const avg = abdL.map((v, i) => v != null && abdR[i] != null ? (v + abdR[i]) / 2 : (v ?? abdR[i]));
  const reps = segment(avg, 'max', 30);
  if (!reps.length) return fail('没认出完整的侧平举。确认是正面拍，肩、手肘、髋都在画面里，并且至少抬起放下一次。');
  const lift = (sd) => series(frames, [sd.ear, sd.sh, L.sh, R.sh], p => (p[sd.sh].y - p[sd.ear].y) / dist(p[L.sh], p[R.sh]));
  const liftL = lift(L), liftR = lift(R);
  const elL = series(frames, [L.sh, L.el, L.wr], p => angle(p[L.sh], p[L.el], p[L.wr]));
  const elR = series(frames, [R.sh, R.el, R.wr], p => angle(p[R.sh], p[R.el], p[R.wr]));
  const t = frames.map(f => f.t);
  const shrug = (arr, r) => at(arr, r.i0) && at(arr, r.ie) != null ? (arr[r.i0] - arr[r.ie]) / arr[r.i0] : null;
  const rows = reps.map((r, k) => ({n:k+1, ie:r.ie, L:at(abdL, r.ie), R:at(abdR, r.ie), shL:shrug(liftL, r), shR:shrug(liftR, r),
    elL:at(elL, r.ie), elR:at(elR, r.ie), down:t[r.i1]-t[r.ie]}));
  const F = [], m = key => median(rows.map(x => x[key]));
  const mL = m('L'), mR = m('R'), sL = m('shL'), sR = m('shR'), mDown = m('down'), mEl = median(rows.flatMap(x => [x.elL, x.elR]));
  const hi = (v, who) => { if (v == null) return; if (v < 65) F.push({lv:'warn', t:who+'没抬到肩高（约 '+deg(v)+'）。抬到和肩差不多高（约 90°）。'}); else if (v > 110) F.push({lv:'warn', t:who+'抬太高了（约 '+deg(v)+'）。到和肩差不多高就停，再往上容易耸肩。'}); };
  hi(mL, '左手'); hi(mR, '右手');
  if (mL != null && mR != null && mL >= 65 && mL <= 110 && mR >= 65 && mR <= 110) F.push({lv:'good', t:'抬起高度合适（左 '+deg(mL)+' / 右 '+deg(mR)+'）。'});
  if (mL != null && mR != null && Math.abs(mL - mR) > 12) F.push({lv:'warn', t:'两边高度差约 '+deg(Math.abs(mL - mR))+'，'+(mL < mR ? '左' : '右')+'边低一些。跟着低的那边的高度做，或者单边分开练。'});
  const shr = [];
  if (sL != null && sL > 0.15) shr.push('左');
  if (sR != null && sR > 0.15) shr.push('右');
  if (shr.length) F.push({lv:'warn', t:'抬起时'+shr.join('、')+'边耸肩了。重量减一点，想象把手臂往两边推远，肩膀往下沉。'+(sR != null && sL != null && sR - sL > 0.08 ? '右边耸得更明显，和你右侧上斜方偏紧对得上。' : '')});
  else if (sL != null || sR != null) F.push({lv:'good', t:'抬起时没有明显耸肩。'});
  if (mEl != null && mEl < 140) F.push({lv:'warn', t:'手肘弯得太多（约 '+deg(mEl)+'），变成往上提了。手肘保持微屈就行。'});
  if (mDown != null && mDown < 1.2) F.push({lv:'warn', t:'放下太快（约 '+sec(mDown)+'），用 2–3 秒慢慢放。'});
  F.push({lv:'info', t:'左右是按你自己的左右算的。如果是自拍（前置摄像头），左右可能反了。'});
  const worst = rows.reduce((a, b) => Math.max(b.shL ?? 0, b.shR ?? 0) > Math.max(a.shL ?? 0, a.shR ?? 0) ? b : a, rows[0]);
  const keyOf = x => ({i:x.ie, lines:[[L.sh,R.sh],[L.sh,L.el],[L.el,L.wr],[R.sh,R.el],[R.el,R.wr],[L.sh,L.hip],[R.sh,R.hip]],
    labels:[[L.el,'左 '+deg(x.L)],[R.el,'右 '+deg(x.R)]]});
  return {ok:true, side:'front', reps:rows, keyRep:worst.n, keys:rows.map(keyOf), findings:F,
    table:{head:['次','左手高度','右手高度','左耸肩','右耸肩','放下用时'], rows:rows.map(x => [x.n, deg(x.L), deg(x.R), x.shL == null ? '–' : pctTxt(Math.max(0, x.shL)), x.shR == null ? '–' : pctTxt(Math.max(0, x.shR)), sec(x.down)])},
    metrics:{'左':r0(mL)+'°','右':r0(mR)+'°','右耸肩':sR == null ? '–' : pctTxt(Math.max(0, sR))}};
}

/* ---------- 平板支撑 ---------- */
function plank(frames){
  const side = pickSide(frames), S = SIDE[side];
  const dt = frames.length > 1 ? (frames[frames.length-1].t - frames[0].t) / (frames.length - 1) : 0;
  const good = frames.map((f, i) => {
    if (!ok(f.p, [S.sh, S.hip, S.an])) return null;
    const p = f.p, flat = Math.abs(Math.atan2(p[S.an].y - p[S.sh].y, Math.abs(p[S.an].x - p[S.sh].x)) * 180 / Math.PI);
    if (flat > 35) return null;
    return {i, dev:offsetBelow(p[S.hip], p[S.sh], p[S.an]), head: ok(p, [S.ear]) ? offsetBelow(p[S.ear], p[S.hip], p[S.sh]) : null};
  }).filter(Boolean);
  if (good.length < 5) return fail('没认出平板支撑的姿势。确认是侧面拍，肩、髋、脚踝都在画面里，身体接近水平。');
  const devs = good.map(g => g.dev), mDev = median(devs), heads = good.map(g => g.head), mHead = median(heads);
  const n3 = Math.max(1, Math.floor(good.length / 3));
  const early = median(devs.slice(0, n3)), late = median(devs.slice(-n3));
  const F = [];
  if (mDev > 0.04) F.push({lv:'warn', t:'塌腰：髋比肩到脚踝的连线低约 '+pctTxt(mDev)+'（按身体长度算）。收紧肚子和屁股，把髋抬到一条线上。'});
  else if (mDev < -0.06) F.push({lv:'warn', t:'屁股撅高了（比连线高约 '+pctTxt(-mDev)+'）。放低到肩、髋、脚踝一条线。'});
  else F.push({lv:'good', t:'身体基本是一条直线。'});
  if (late - early > 0.03) F.push({lv:'warn', t:'后面越撑越塌。塌下去的时候就该结束这一组了，硬撑练不到核心，只会压腰。'});
  if (mHead != null && mHead > 0.08) F.push({lv:'warn', t:'头掉下去了。下巴微收，眼睛看双手前面一点的地面。'});
  F.push({lv:'info', t:'这段认出的标准姿势约 '+sec(good.length * dt)+'。'});
  const worstG = good.reduce((a, b) => Math.abs(b.dev) > Math.abs(a.dev) ? b : a, good[0]);
  const key = {i:worstG.i, lines:[[S.ear,S.sh],[S.sh,S.hip],[S.hip,S.an]], guide:[S.sh,S.an], labels:[[S.hip,(worstG.dev > 0 ? '低 ' : '高 ')+pctTxt(Math.abs(worstG.dev))]]};
  return {ok:true, side, reps:[], keyRep:1, keys:[key], findings:F, table:null,
    metrics:{'髋偏离':(mDev > 0 ? '低 ' : '高 ')+pctTxt(Math.abs(mDev)),'时长':sec(good.length * dt)}};
}

/* ---------- 体态照片 ---------- */
function postureSide(p){
  if (!p) return fail(NO_PERSON);
  const fr = frontness(p);
  if (fr != null && fr > 0.45) return fail('这张不像侧面照：两个肩膀都看得很清楚。侧身站，让镜头正对身体侧面再拍。');
  const side = (['sh','hip','kn','an'].reduce((s, k) => s + p[SIDE.left[k]].v - p[SIDE.right[k]].v, 0) >= 0) ? 'left' : 'right', S = SIDE[side];
  if (!ok(p, [S.ear, S.sh, S.hip, S.kn, S.an])) return fail('耳朵、肩、髋、膝、脚踝没有全认出来。确认是侧面全身照、光线够亮、衣服别太宽松。');
  const fwd = ok(p, [NOSE]) && p[NOSE].x < p[S.ear].x ? -1 : 1;
  const head = lean(p[S.sh], p[S.ear], fwd), trunk = lean(p[S.hip], p[S.sh], fwd), pelvis = lean(p[S.an], p[S.hip], fwd);
  const kneeAng = angle(p[S.hip], p[S.kn], p[S.an]);
  const kneeBehind = (p[S.kn].x - (p[S.hip].x + (p[S.an].x - p[S.hip].x) * (p[S.kn].y - p[S.hip].y) / ((p[S.an].y - p[S.hip].y) || 1))) * fwd < 0;
  const hyper = kneeBehind && kneeAng != null ? 180 - kneeAng : 0;
  const F = [];
  if (head > 20) F.push({lv:'bad', t:'明显头前伸：耳朵在肩膀前方约 '+deg(head)+'。'});
  else if (head > 10) F.push({lv:'warn', t:'轻度头前伸：耳朵在肩膀前方约 '+deg(head)+'。'});
  else F.push({lv:'good', t:'头的位置基本正（耳朵相对肩膀约 '+deg(head)+'）。'});
  if (pelvis > 8) F.push({lv:'bad', t:'骨盆明显往前顶：髋在脚踝前方约 '+deg(pelvis)+'。'});
  else if (pelvis > 4) F.push({lv:'warn', t:'骨盆略往前顶：髋在脚踝前方约 '+deg(pelvis)+'。'});
  else F.push({lv:'good', t:'骨盆位置基本正（髋相对脚踝约 '+deg(pelvis)+'）。'});
  if (trunk < -5 && pelvis > 4) F.push({lv:'warn', t:'上身往后倒（约 '+deg(-trunk)+'）、胯往前顶，是"之"字形的代偿，和体态计划里说的一致。'});
  else if (trunk > 8) F.push({lv:'warn', t:'上身在髋的前面约 '+deg(trunk)+'，有驼背或前倾。'});
  if (hyper > 5) F.push({lv:'warn', t:'膝盖锁死往后顶了（约 '+deg(hyper)+'）。站的时候膝盖微微解锁。'});
  F.push({lv:'info', t:'每 4 周在同样的光线、同样的距离拍一张，比的是变化，单张的绝对值有误差。'});
  return {ok:true, side, reps:[], keyRep:1, findings:F, table:null,
    keys:[{i:0, lines:[[S.ear,S.sh],[S.sh,S.hip],[S.hip,S.kn],[S.kn,S.an]], plumb:S.an, labels:[[S.ear,'头 '+deg(head)],[S.sh,'上身 '+deg(trunk)],[S.hip,'骨盆 '+deg(pelvis)]]}],
    metrics:{'头前伸':r0(head)+'°','骨盆前顶':r0(pelvis)+'°','上身':r0(trunk)+'°'}};
}
function postureFront(p){
  if (!p) return fail(NO_PERSON);
  const L = SIDE.left, R = SIDE.right;
  if (!ok(p, [L.sh, R.sh, L.hip, R.hip])) return fail('两肩和两侧髋没有全认出来。确认是正面全身照、光线够亮。');
  const fr = frontness(p);
  if (fr != null && fr < 0.4) return fail('这张不像正面照：两肩几乎重叠了。正对镜头站好再拍。');
  const tilt = (a, b) => Math.atan2(Math.abs(a.y - b.y), Math.abs(a.x - b.x)) * 180 / Math.PI;
  const higher = (r, l) => r.y < l.y ? '右' : '左';
  const shT = tilt(p[R.sh], p[L.sh]), hipT = tilt(p[R.hip], p[L.hip]);
  const earOK = ok(p, [L.ear, R.ear]), headT = earOK ? tilt(p[R.ear], p[L.ear]) : null;
  const shW = dist(p[L.sh], p[R.sh]), ux = (p[L.sh].x - p[R.sh].x) / shW, uy = (p[L.sh].y - p[R.sh].y) / shW;
  const midX = (p[L.sh].x + p[R.sh].x) / 2, midY = (p[L.sh].y + p[R.sh].y) / 2;
  const shift = ok(p, [NOSE]) ? ((p[NOSE].x - midX) * ux + (p[NOSE].y - midY) * uy) / shW : null;
  const F = [];
  if (shT > 4) F.push({lv:'bad', t:higher(p[R.sh], p[L.sh])+'肩比另一边高，倾斜约 '+deg(shT)+'。'});
  else if (shT > 2) F.push({lv:'warn', t:higher(p[R.sh], p[L.sh])+'肩略高，倾斜约 '+deg(shT)+'。'});
  else F.push({lv:'good', t:'两肩基本一样高（倾斜约 '+deg(shT)+'）。'});
  if (headT != null){
    if (headT > 3) F.push({lv:'warn', t:'头往一侧歪（两耳连线倾斜约 '+deg(headT)+'，'+(p[R.ear].y > p[L.ear].y ? '往右肩方向' : '往左肩方向')+'）。'});
    else F.push({lv:'good', t:'头基本是正的。'});
  }
  if (shift != null && Math.abs(shift) > 0.08) F.push({lv:'warn', t:'头偏向'+(shift > 0 ? '左' : '右')+'边，偏离两肩中线约 '+pctTxt(Math.abs(shift))+'（按肩宽算）。'});
  if (hipT > 2.5) F.push({lv:'warn', t:higher(p[R.hip], p[L.hip])+'侧髋偏高，倾斜约 '+deg(hipT)+'。站的时候两脚均匀受力，别总把重心压在一条腿上。'});
  F.push({lv:'info', t:'左右按你自己的左右算。用后置摄像头或请别人拍；自拍会左右颠倒。'});
  return {ok:true, side:'front', reps:[], keyRep:1, findings:F, table:null,
    keys:[{i:0, lines:[[L.sh,R.sh],[L.hip,R.hip],[L.ear,R.ear],[L.sh,L.hip],[R.sh,R.hip]], labels:[[R.sh,'肩 '+deg(shT)],[R.hip,'髋 '+deg(hipT)]]}],
    metrics:{'肩倾斜':r0(shT)+'°','高的一侧':higher(p[R.sh], p[L.sh]),'头歪':r0(headT)+'°'}};
}

const VIDEO = {squat, rdl, thrust, row, raise, plank};
// frames: [{t: 秒, p: 像素坐标的 33 个点或 null}]
export function analyzeVideo(key, frames){
  const seen = frames.filter(f => f.p).length;
  if (seen < Math.max(5, frames.length * 0.3)) return fail(NO_PERSON);
  const res = VIDEO[key](frames);
  if (res.ok && key !== 'plank'){ const n = viewNote(frames, key === 'raise' ? 'front' : 'side'); if (n) res.findings.push(n); }
  return res;
}
export function analyzePhoto(key, p){ return key === 'postureFront' ? postureFront(p) : postureSide(p); }
