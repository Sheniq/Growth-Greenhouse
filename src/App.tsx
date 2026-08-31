import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Award, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, Database, Flower2, FolderOpen, Gift, Leaf,
  Menu, Plus, RefreshCw, Settings2, Sprout, Target, Trophy, Warehouse, X,
} from "lucide-react";
import Widget from "./Widget";

type View = "greenhouse" | "garden" | "rewards" | "settings";
type GoalStatus = "active" | "paused" | "completed";
type PlantKind = "sprout" | "fern" | "flower" | "cactus";
type Goal = {
  id: string;
  title: string;
  description: string;
  weekly: number;
  daily: number;
  startDate: string;
  exe: string;
  app: string;
  status: GoalStatus;
  completedAt?: string;
  plantKind?: PlantKind;
};
type ManualRecord = { id: string; goalId: string; date: string; minutes: number };
type Reward = { id: string; name: string; cost: number; annual: boolean; redeemed: boolean };
type Session = { id: number; appName: string; exeName: string; startTime: number; endTime: number | null; durationMs: number | null };
type Source = { available: boolean; installed: boolean; databasePath: string; lastModifiedMs: number | null };

const GOALS_KEY = "growth-greenhouse.goals";
const RECORDS_KEY = "growth-greenhouse.records";
const REWARDS_KEY = "growth-greenhouse.rewards";
const PATH_KEY = "growth-greenhouse.patina-path";
const UNIT = 25;
const plantKinds: PlantKind[] = ["sprout", "fern", "flower", "cactus"];
const today = () => new Date().toLocaleDateString("sv-SE");
const monday = (date = new Date()) => {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = value.getDay();
  value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
  value.setHours(0, 0, 0, 0);
  return value;
};
const dateText = (date: Date) => date.toLocaleDateString("sv-SE");
const read = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
const minutes = (value: number) => value < 60 ? `${Math.round(value)} 分钟` : `${Math.floor(value / 60)} 小时${Math.round(value % 60) ? ` ${Math.round(value % 60)} 分钟` : ""}`;
const stage = (units: number, completed = false) => completed ? "已移入花园" : units >= 30 ? "开花结果" : units >= 15 ? "成熟植物" : units >= 5 ? "茁壮幼苗" : units >= 1 ? "刚刚发芽" : "一粒种子";
const plantKindFor = (goal: Goal) => goal.plantKind ?? plantKinds[Array.from(goal.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % plantKinds.length];
const dateLabel = (value?: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" }) : "尚未记录";
const sessionTime = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const sessionDuration = (session: Session) => Math.max(0, (session.endTime ?? Date.now()) - session.startTime) / 60000;

function Plant({ units, completed = false, small = false, kind = "sprout" }: { units: number; completed?: boolean; small?: boolean; kind?: PlantKind }) {
  const level = completed ? 5 : units >= 30 ? 4 : units >= 15 ? 3 : units >= 5 ? 2 : units >= 1 ? 1 : 0;
  return <div className={`plant plant-${level} plant-kind-${kind} ${small ? "plant-small" : ""}`} aria-label={`${stage(units, completed)}，${kind}`}>
    <div className="plant-halo" /><div className="plant-pot"><span /></div>
    {kind === "fern" ? <div className="fern-fronds"><i /><i /><i /><i /></div> : null}
    {kind === "cactus" ? <div className="cactus-body"><i /><b /></div> : null}
    {kind !== "fern" && kind !== "cactus" ? <><div className="plant-stem" /><div className="plant-leaf plant-leaf-left" /><div className="plant-leaf plant-leaf-right" /></> : null}
    {kind === "flower" && level >= 3 ? <div className="plant-flower"><Flower2 size={25} /></div> : null}
    {level === 0 ? <div className="plant-seed" /> : null}
    {completed && kind !== "cactus" ? <div className="plant-crown"><Sprout size={27} /></div> : null}
  </div>;
}

function unionMinutes(sessions: Session[], from: number, to: number) {
  const ranges = sessions.map((session) => ({
    from: Math.max(session.startTime, from),
    to: Math.min(session.endTime ?? to, to),
  })).filter((range) => range.to > range.from).sort((a, b) => a.from - b.from);
  let total = 0;
  let current: { from: number; to: number } | undefined;
  for (const range of ranges) {
    if (!current) current = range;
    else if (range.from <= current.to) current.to = Math.max(current.to, range.to);
    else {
      total += current.to - current.from;
      current = range;
    }
  }
  if (current) total += current.to - current.from;
  return total / 60000;
}

function goalStats(goal: Goal, sessions: Session[], records: ManualRecord[]) {
  const start = new Date(`${goal.startDate}T00:00:00`).getTime();
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = Math.max(start, monday().getTime());
  const matching = sessions.filter((session) => goal.exe && session.exeName.toLowerCase() === goal.exe.toLowerCase());
  const ownRecords = records.filter((record) => record.goalId === goal.id);
  const manual = ownRecords.reduce((sum, record) => sum + record.minutes, 0);
  const manualDay = ownRecords.filter((record) => record.date === today()).reduce((sum, record) => sum + record.minutes, 0);
  const manualWeek = ownRecords.filter((record) => record.date >= dateText(new Date(weekStart))).reduce((sum, record) => sum + record.minutes, 0);
  const auto = unionMinutes(matching, start, now);
  const autoDay = unionMinutes(matching, Math.max(start, dayStart.getTime()), now);
  const autoWeek = unionMinutes(matching, weekStart, now);
  const total = auto + manual;
  return { total, today: autoDay + manualDay, week: autoWeek + manualWeek, units: Math.floor(total / UNIT), points: Math.floor(total / UNIT) };
}

async function sourceSnapshot(path?: string): Promise<Source> {
  if ("__TAURI_INTERNALS__" in window) return invoke<Source>("get_patina_source", { databasePath: path || null });
  const response = await fetch(`/api/patina/source${path ? `?path=${encodeURIComponent(path)}` : ""}`);
  if (!response.ok) throw new Error("网页本地接口无法连接，请确认正在运行 pnpm dev");
  return await response.json() as Source;
}

async function sessionSnapshot(since: number, until: number, path?: string): Promise<Session[]> {
  if ("__TAURI_INTERNALS__" in window) return invoke<Session[]>("read_patina_sessions", { sinceMs: since, untilMs: until, databasePath: path || null });
  const query = new URLSearchParams({ sinceMs: String(since), untilMs: String(until) });
  if (path) query.set("path", path);
  const response = await fetch(`/api/patina/sessions?${query.toString()}`);
  if (!response.ok) throw new Error((await response.text()) || "读取 Patina 会话失败");
  return await response.json() as Session[];
}

export default function App() {
  if (window.location.hash === "#widget") return <Widget />;
  const [view, setView] = useState<View>("greenhouse");
  const [goals, setGoals] = useState<Goal[]>(() => read(GOALS_KEY, []));
  const [records, setRecords] = useState<ManualRecord[]>(() => read(RECORDS_KEY, []));
  const [rewards, setRewards] = useState<Reward[]>(() => read(REWARDS_KEY, [{ id: "first", name: "给今天的小奖励", cost: 4, annual: false, redeemed: false }]));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [path, setPath] = useState(() => localStorage.getItem(PATH_KEY) ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gardenSelectedId, setGardenSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<"goal" | "record" | "reward" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const stats = useMemo(() => new Map(goals.map((goal) => [goal.id, goalStats(goal, sessions, records)])), [goals, sessions, records]);
  const selected = goals.find((goal) => goal.id === selectedId) ?? goals[0] ?? null;
  const earnedPoints = Array.from(stats.values()).reduce((sum, stat) => sum + stat.points, 0);
  const redeemedPoints = rewards.filter((reward) => reward.redeemed).reduce((sum, reward) => sum + reward.cost, 0);
  const totalPoints = Math.max(0, earnedPoints - redeemedPoints);
  const active = goals.filter((goal) => goal.status !== "completed");
  const completed = goals.filter((goal) => goal.status === "completed");

  const sync = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      const current = await sourceSnapshot(path);
      setSource(current);
      if (current.available) {
        const start = Math.min(Date.now() - 90 * 86400000, ...goals.map((goal) => new Date(`${goal.startDate}T00:00:00`).getTime()), Date.now());
        setSessions(await sessionSnapshot(start, Date.now(), current.databasePath));
      } else setSessions([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取 Patina 失败");
    } finally {
      setSyncing(false);
    }
  }, [goals, path]);

  useEffect(() => {
    void sync();
    const timer = window.setInterval(() => void sync(), 30000);
    return () => window.clearInterval(timer);
  }, [sync]);
  useEffect(() => { write(GOALS_KEY, goals); }, [goals]);
  useEffect(() => { write(RECORDS_KEY, records); }, [records]);
  useEffect(() => { write(REWARDS_KEY, rewards); }, [rewards]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(".menu-wrap")) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const addGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const exe = String(data.get("exe") ?? "");
    const goal: Goal = { id: crypto.randomUUID(), title: String(data.get("title") ?? "新的学习目标").trim(), description: String(data.get("description") ?? "").trim(), weekly: Number(data.get("weekly") ?? 200), daily: Number(data.get("daily") ?? 25), startDate: String(data.get("startDate") ?? today()), exe, app: String(data.get("app") ?? exe), status: "active", plantKind: plantKinds[goals.length % plantKinds.length] };
    setGoals((current) => [...current, goal]);
    setSelectedId(goal.id);
    setModal(null);
  };
  const addRecord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setRecords((current) => [...current, { id: crypto.randomUUID(), goalId: String(data.get("goalId")), date: String(data.get("date") ?? today()), minutes: Math.max(1, Number(data.get("minutes") ?? 25)) }]);
    setModal(null);
  };
  const addReward = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setRewards((current) => [...current, { id: crypto.randomUUID(), name: String(data.get("name") ?? "新奖励"), cost: Math.max(1, Number(data.get("cost") ?? 10)), annual: data.get("annual") === "on", redeemed: false }]);
    setModal(null);
  };
  const savePath = (value: string) => {
    setPath(value.trim());
    localStorage.setItem(PATH_KEY, value.trim());
  };
  const selectDatabaseFile = async (file: File) => {
    setError("");
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const nativePath = (file as File & { path?: string }).path;
        if (!nativePath) throw new Error("当前窗口没有返回文件路径，请直接填写数据库路径");
        savePath(nativePath);
        return;
      }
      const response = await fetch("/api/patina/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file });
      if (!response.ok) throw new Error((await response.text()) || "无法读取选中的数据库");
      const selected = await response.json() as Source;
      savePath(selected.databasePath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "选择 Patina 数据库失败");
    }
  };
  const go = (next: View) => { setView(next); setMenuOpen(false); };
  const pageName = view === "greenhouse" ? "温室" : view === "garden" ? "成长温室" : view === "rewards" ? "奖励架" : "数据源设置";
  const pageTitle = view === "greenhouse" ? "今天，也在生长" : view === "garden" ? "成长温室" : view === "rewards" ? "把期待放在这里" : "连接你的时间";

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Sprout size={20} /></div><div><strong>Growth Greenhouse</strong><span>LEARNING SPACE</span></div></div>
      <nav><button className={view === "greenhouse" ? "active" : ""} onClick={() => go("greenhouse")}><Leaf size={18} /> 我的温室</button><button className={view === "garden" ? "active" : ""} onClick={() => go("garden")}><Warehouse size={18} /> 成长温室 <b>{completed.length}</b></button><button className={view === "rewards" ? "active" : ""} onClick={() => go("rewards")}><Gift size={18} /> 奖励架 <b>{totalPoints}</b></button></nav>
      <div className="sidebar-bottom"><div className="patina-status"><i className={source?.available ? "online" : ""} /><div><strong>{source?.available ? "Patina 已连接" : "Patina 未连接"}</strong><span>{source?.available ? "自动记录中" : "等待数据源"}</span></div></div><button className="settings-link" onClick={() => go("settings")}><Settings2 size={17} /> 数据源设置</button></div>
    </aside>
    <main className="main"><header className="topbar"><div><span className="breadcrumb"><button className="breadcrumb-link" onClick={() => go("greenhouse")}>我的空间</button><ChevronRight size={14} /><button className="breadcrumb-link" onClick={() => go(view)}>{pageName}</button></span><h1>{pageTitle}</h1></div><div className="top-actions">{view === "greenhouse" ? <div className="points"><Award size={17} /><strong>{totalPoints}</strong><span>成长点</span></div> : null}<div className="menu-wrap"><button className="menu-button" title="打开菜单" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>{menuOpen ? <div className="menu-popover"><button onClick={() => go("greenhouse")}><Leaf size={15} /> 我的温室</button><button onClick={() => go("garden")}><Warehouse size={15} /> 成长温室</button><button onClick={() => go("rewards")}><Gift size={15} /> 奖励架</button><button onClick={() => go("settings")}><Settings2 size={15} /> 数据源设置</button></div> : null}</div></div></header>
      {error ? <div className="alert"><CircleHelp size={16} /> {error}<button onClick={() => setError("")}><X size={15} /></button></div> : null}
      {view === "greenhouse" ? <><section className="welcome-banner"><div><span className="section-label">THIS WEEK</span><h2>{active.length ? "你的温室正在生长" : "先种下第一个目标"}</h2><p>{active.length ? `正在照料 ${active.length} 个目标。每 ${UNIT} 分钟，留下一个成长单位。` : "从一件你真正想学的事开始，温室会记住每一步。"}</p><div className="banner-actions"><button className="primary" onClick={() => setModal("goal")}><Plus size={16} /> 种下新目标</button><button className="ghost" onClick={() => setModal("record")} disabled={!goals.length}><Clock3 size={16} /> 手动记录</button></div></div><div className="banner-scene"><div className="sun" /><div className="cloud cloud-a" /><div className="cloud cloud-b" /><div className="ground" /><div className="scene-glass glass-a" /><div className="scene-glass glass-b" /><Plant kind={active[0] ? plantKindFor(active[0]) : "flower"} units={active[0] ? stats.get(active[0].id)?.units ?? 0 : 15} /></div></section><div className="section-heading"><div><span className="section-label">YOUR PLANTS</span><h2>正在培育</h2></div><button className="text-button" onClick={() => setModal("goal")}><Plus size={16} /> 添加目标</button></div><section className="plant-grid">{active.length ? active.map((goal) => <GoalCard key={goal.id} goal={goal} stat={stats.get(goal.id)!} selected={selected?.id === goal.id} onClick={() => setSelectedId(goal.id)} />) : <EmptyState onClick={() => setModal("goal")} />}</section>{selected ? <Detail goal={selected} stat={stats.get(selected.id)!} onRecord={() => setModal("record")} onPause={() => setGoals((current) => current.map((goal) => goal.id === selected.id ? { ...goal, status: goal.status === "paused" ? "active" : "paused" } : goal))} onComplete={() => setGoals((current) => current.map((goal) => goal.id === selected.id ? { ...goal, status: "completed", completedAt: today() } : goal))} /> : null}<section className="lower-grid"><Garden completed={completed} onOpen={() => go("garden")} /><MiniRewards rewards={rewards} points={totalPoints} onOpen={() => go("rewards")} /></section></> : view === "garden" ? <CompletedGarden completed={completed} selectedId={gardenSelectedId} onSelect={setGardenSelectedId} onBack={() => go("greenhouse")} stats={stats} /> : view === "rewards" ? <Rewards rewards={rewards} points={totalPoints} onAdd={() => setModal("reward")} onRedeem={(id) => { const reward = rewards.find((item) => item.id === id); if (reward && !reward.redeemed && totalPoints >= reward.cost) setRewards((current) => current.map((item) => item.id === id ? { ...item, redeemed: true } : item)); }} /> : <Settings path={path} source={source} sessions={sessions} onSave={savePath} onFileSelect={selectDatabaseFile} />}
    </main>{modal ? <Modal onClose={() => setModal(null)}>{modal === "goal" ? <GoalForm sessions={sessions} goals={goals} onSubmit={addGoal} /> : modal === "record" ? <RecordForm goals={goals} selectedId={selected?.id} onSubmit={addRecord} /> : <RewardForm onSubmit={addReward} />}</Modal> : null}
  </div>;
}

function GoalCard({ goal, stat, selected, onClick }: { goal: Goal; stat: ReturnType<typeof goalStats>; selected: boolean; onClick: () => void }) { const percent = goal.weekly ? Math.min(100, stat.week / goal.weekly * 100) : 0; return <button className={`plant-card ${selected ? "selected" : ""}`} onClick={onClick}><div className="card-plant"><Plant kind={plantKindFor(goal)} units={stat.units} /></div><div className="card-info"><div className="card-title"><strong>{goal.title}</strong><span>{stage(stat.units)}</span></div><p>{goal.app || "手动记录"}</p><div className="progress"><i style={{ width: `${percent}%` }} /></div><div className="card-meta"><span>本周 {minutes(stat.week)}</span><span>{stat.units} 单位</span></div></div></button>; }
function EmptyState({ onClick }: { onClick: () => void }) { return <div className="empty-state"><div><Sprout size={24} /></div><strong>温室还没有植物</strong><span>创建一个目标，开始留下你的第一片叶子。</span><button className="secondary" onClick={onClick}><Plus size={15} /> 创建目标</button></div>; }
function Detail({ goal, stat, onRecord, onPause, onComplete }: { goal: Goal; stat: ReturnType<typeof goalStats>; onRecord: () => void; onPause: () => void; onComplete: () => void }) { const todayPercent = goal.daily ? Math.min(100, stat.today / goal.daily * 100) : 0; return <section className="detail-panel"><div className="detail-copy"><span className="section-label">CURRENT CARE</span><h2>{goal.title}</h2><p>{goal.description || "每天照料一点，目标就会慢慢长大。"}</p><div className="detail-plant"><Plant kind={plantKindFor(goal)} units={stat.units} /><div><strong>{stage(stat.units)}</strong><span>{stat.units < 30 ? `再积累 ${30 - stat.units} 个成长单位，迎来下一阶段` : "这株植物已经准备好开花了"}</span></div></div></div><div className="detail-right"><div className="metric"><span>今日学习</span><strong>{minutes(stat.today)}</strong><div className="metric-bar"><i style={{ width: `${todayPercent}%` }} /></div><small>目标 {minutes(goal.daily)}</small></div><div className="metric"><span>本周积累</span><strong>{minutes(stat.week)}</strong><small>目标 {minutes(goal.weekly)}</small></div><div className="metric"><span>成长单位</span><strong>{stat.units}</strong><small>每 25 分钟 +1</small></div><div className="detail-buttons"><button className="secondary" onClick={onRecord}><Clock3 size={15} /> 补记学习</button>{stat.units >= 30 ? <button className="primary" onClick={onComplete}><Flower2 size={15} /> 移入花园</button> : <button className="quiet-icon" onClick={onPause} title={goal.status === "paused" ? "恢复目标" : "暂停目标"}>{goal.status === "paused" ? <RefreshCw size={16} /> : <Target size={16} />}</button>}</div></div></section>; }
function Garden({ completed, onOpen }: { completed: Goal[]; onOpen: () => void }) { return <button className="panel garden garden-trigger" onClick={onOpen}><div className="panel-heading"><div><span className="section-label">YOUR GREENHOUSE</span><h2>已完成的目标</h2></div><Warehouse size={19} /></div>{completed.length ? <div className="garden-row">{completed.slice(0, 4).map((goal) => <div key={goal.id}><Plant kind={plantKindFor(goal)} units={30} completed small /><span>{goal.title}</span></div>)}</div> : <div className="garden-empty"><div className="fence" /><span>完成一株植物，它就会来到这里。</span></div>}<span className="garden-cta">进入成长温室 <ChevronRight size={14} /></span></button>; }
function CompletedGarden({ completed, selectedId, onSelect, onBack, stats }: { completed: Goal[]; selectedId: string | null; onSelect: (id: string) => void; onBack: () => void; stats: Map<string, ReturnType<typeof goalStats>> }) { const selected = completed.find((goal) => goal.id === selectedId) ?? null; return <div className="page-stack garden-page"><div className="page-intro garden-page-intro"><button className="back-button" onClick={onBack}><ChevronLeft size={15} /> 返回我的温室</button><span className="section-label">GROWTH GREENHOUSE</span><h2>每一盆，都是完成过的事</h2><p>{completed.length ? `这里收藏着 ${completed.length} 个已经完成的目标。点击一盆植物，查看它留下的时间。` : "当一个目标完成，它会从培育区搬到这里。"}</p></div><section className="garden-scene"><div className="scene-roof" /><div className="scene-sun" /><div className="scene-spark spark-one" /><div className="scene-spark spark-two" /><div className="garden-bench" /><div className="completed-plant-grid">{completed.length ? completed.map((goal) => <button className={`garden-plant ${selected?.id === goal.id ? "selected" : ""}`} key={goal.id} onClick={() => onSelect(goal.id)}><Plant kind={plantKindFor(goal)} units={30} completed /><strong>{goal.title}</strong><span>{dateLabel(goal.completedAt)}</span></button>) : <div className="garden-scene-empty"><Warehouse size={28} /><strong>这里还没有完成的植物</strong><span>先回到温室，照料一个目标吧。</span><button className="secondary" onClick={onBack}><ChevronLeft size={15} /> 返回培育区</button></div>}</div></section>{selected ? <section className="panel garden-detail"><div><span className="section-label">PLANT RECORD</span><h2>{selected.title}</h2><p>{selected.description || "这段学习没有留下额外描述。"}</p><dl><div><dt>完成日期</dt><dd>{dateLabel(selected.completedAt)}</dd></div><div><dt>开始日期</dt><dd>{dateLabel(selected.startDate)}</dd></div><div><dt>计划目标</dt><dd>每周 {minutes(selected.weekly)}</dd></div><div><dt>学习软件</dt><dd>{selected.app || "手动记录"}</dd></div><div><dt>累计成长</dt><dd>{stats.get(selected.id)?.units ?? 0} 个单位</dd></div></dl></div><div className="garden-detail-plant"><Plant kind={plantKindFor(selected)} units={30} completed /></div></section> : null}</div>; }
function MiniRewards({ rewards, points, onOpen }: { rewards: Reward[]; points: number; onOpen: () => void }) { return <section className="panel mini-rewards"><div className="panel-heading"><div><span className="section-label">REWARD SHELF</span><h2>奖励架</h2></div><button className="text-button" onClick={onOpen}>查看全部 <ChevronRight size={15} /></button></div>{rewards.slice(0, 2).map((reward) => <div className="mini-reward" key={reward.id}><Gift size={17} /><div><strong>{reward.name}</strong><span>{reward.annual ? "年度奖励" : "期待中的小奖励"}</span></div><b>{reward.redeemed ? "已兑换" : `${reward.cost} 点`}</b></div>)}<div className="mini-points"><Award size={16} /> 现在有 <strong>{points} 点</strong> 成长点</div></section>; }
function Rewards({ rewards, points, onAdd, onRedeem }: { rewards: Reward[]; points: number; onAdd: () => void; onRedeem: (id: string) => void }) { return <div className="page-stack"><div className="page-intro"><span className="section-label">REWARD SHELF</span><p>学习留下的积累，可以换成你真正期待的东西。</p><div className="big-points"><Award size={22} /><strong>{points}</strong><span>可用成长点</span></div><button className="primary" onClick={onAdd}><Plus size={16} /> 添加奖励</button></div><section className="panel reward-list">{rewards.map((reward) => <div className="reward-row" key={reward.id}><div className="reward-icon"><Gift size={20} /></div><div><strong>{reward.name}</strong><span>{reward.annual ? "年度奖励" : "给今天的小奖励"}</span></div><button className="secondary" disabled={reward.redeemed || points < reward.cost} onClick={() => onRedeem(reward.id)}>{reward.redeemed ? <><Check size={14} /> 已兑换</> : `${reward.cost} 点兑换`}</button></div>)}</section></div>; }
function Settings({ path, source, sessions, onSave, onFileSelect }: { path: string; source: Source | null; sessions: Session[]; onSave: (path: string) => void; onFileSelect: (file: File) => Promise<void> }) {
  const [value, setValue] = useState(path);
  const recent = [...sessions].sort((a, b) => b.startTime - a.startTime).slice(0, 12);
  const totalMinutes = sessions.reduce((sum, session) => sum + sessionDuration(session), 0);
  return <div className="page-stack settings-page"><div className="page-intro"><span className="section-label">DATA SOURCE</span><h2>让 Patina 负责记录时间</h2><p>网页通过本机只读接口读取已安装 Patina 的 sessions 数据；Tauri 版本使用同一条读取逻辑。</p></div><section className="panel settings-panel"><div className="settings-state"><i className={source?.available ? "online" : ""} /><div><strong>{source?.available ? "已连接 Patina" : "未连接 Patina"}</strong><span>{source?.available ? `数据库最近更新于 ${source.lastModifiedMs ? new Date(source.lastModifiedMs).toLocaleTimeString() : "刚刚"}` : "请确认 Patina 已安装并有数据"}</span></div></div><div className="path-hints"><div><span>Patina 程序通常位于</span><code>%LOCALAPPDATA%\Patina\Patina.exe</code></div><div><span>Patina 数据库通常位于</span><code>%APPDATA%\Patina\patina.db</code></div></div><label>Patina 数据库路径<span>默认路径：%APPDATA%\Patina\patina.db</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder="留空使用默认路径" /></label><div className="settings-actions"><button className="primary" onClick={() => onSave(value)}><Check size={15} /> 保存路径</button><label className="file-picker secondary"><FolderOpen size={15} /> 从资源管理器选择<input type="file" accept=".db,.sqlite,.sqlite3" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFileSelect(file); event.currentTarget.value = ""; }} /></label></div>{source?.databasePath ? <code className="selected-path">当前读取：{source.databasePath}</code> : null}</section><section className="panel database-records"><div className="panel-heading"><div><span className="section-label">PATINA SESSIONS</span><h2>数据库记录</h2></div><Database size={19} /></div><div className="record-summary"><strong>{sessions.length}</strong><span>条记录</span><b>{minutes(totalMinutes)}</b><span>读取范围内总时长</span></div>{recent.length ? <div className="records-table"><div className="records-row records-head"><span>应用</span><span>开始时间</span><span>结束时间</span><span>时长</span></div>{recent.map((session) => <div className="records-row" key={session.id}><strong title={session.exeName}>{session.appName || session.exeName}</strong><span>{sessionTime(session.startTime)}</span><span>{session.endTime ? sessionTime(session.endTime) : "进行中"}</span><span>{minutes(sessionDuration(session))}</span></div>)}</div> : <div className="records-empty"><Database size={22} /><span>暂时没有读到 sessions 记录</span><small>请确认数据库路径正确，并让 Patina 先产生一些活动记录。</small></div>}<p className="records-note">网页当前展示最近 90 天的 Patina sessions，数据只读，不会写回原数据库。</p></section></div>;
}
function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal"><button className="modal-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>{children}</div></div>; }
function GoalForm({ sessions, goals, onSubmit }: { sessions: Session[]; goals: Goal[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const apps = Array.from(new Map(sessions.map((session) => [session.exeName.toLowerCase(), { exe: session.exeName, app: session.appName || session.exeName }])).values()).filter((item) => !goals.some((goal) => goal.exe.toLowerCase() === item.exe.toLowerCase() && goal.status !== "completed")); return <form className="form" onSubmit={onSubmit}><span className="section-label">NEW PLANT</span><h2>种下一个目标</h2><p>不用想得太远，只填写你现在真正想学的事。</p><label>目标名称<input name="title" required autoFocus placeholder="例如：学会 Blender 建模" /></label><label>一句话描述<input name="description" placeholder="例如：做出第一个可以打印的模型" /></label><div className="form-grid"><label>每周目标（分钟）<input name="weekly" type="number" min="25" step="25" defaultValue="200" /></label><label>每日建议（分钟）<input name="daily" type="number" min="0" step="5" defaultValue="25" /></label></div><label>开始日期<input name="startDate" type="date" defaultValue={today()} /></label><label>关联学习软件<span className="hint">可选。选择后自动累计 Patina 中的有效时长。</span><select name="exe" defaultValue="" onChange={(event) => { const option = event.currentTarget.selectedOptions[0]; const input = event.currentTarget.form?.elements.namedItem("app") as HTMLInputElement | null; if (input) input.value = option?.dataset.app ?? ""; }}><option value="" data-app="">暂不关联，之后手动记录</option>{apps.map((app) => <option key={app.exe} value={app.exe} data-app={app.app}>{app.app}</option>)}</select><input type="hidden" name="app" /></label><button className="primary form-submit"><Sprout size={16} /> 种下目标</button></form>; }
function RecordForm({ goals, selectedId, onSubmit }: { goals: Goal[]; selectedId?: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <form className="form" onSubmit={onSubmit}><span className="section-label">MANUAL SESSION</span><h2>留下学习记录</h2><p>有些学习不在电脑上，也值得被温室记住。</p><label>学习目标<select name="goalId" defaultValue={selectedId ?? goals[0]?.id} required>{goals.filter((goal) => goal.status !== "completed").map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label><div className="form-grid"><label>学习日期<input name="date" type="date" defaultValue={today()} /></label><label>学习时长（分钟）<input name="minutes" type="number" min="1" step="5" defaultValue="25" /></label></div><button className="primary form-submit"><Check size={16} /> 记录这次学习</button></form>; }
function RewardForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <form className="form" onSubmit={onSubmit}><span className="section-label">NEW REWARD</span><h2>放一个奖励上架</h2><p>让积累有一个你期待的去处。</p><label>奖励名称<input name="name" required autoFocus placeholder="例如：买一套新的模型素材" /></label><label>需要成长点<input name="cost" type="number" min="1" defaultValue="10" /></label><label className="check-label"><input name="annual" type="checkbox" /> 这是我的年度奖励</label><button className="primary form-submit"><Gift size={16} /> 放上奖励架</button></form>; }
