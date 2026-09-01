import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
  completedUnits?: number;
  plantKind?: PlantKind;
};
type ManualRecord = { id: string; goalId: string; date: string; minutes: number };
type Reward = { id: string; name: string; cost: number; annual: boolean; redeemed: boolean };
type Session = { id: number; appName: string; exeName: string; startTime: number; endTime: number | null; durationMs: number | null };
type Source = { available: boolean; installed: boolean; databasePath: string; lastModifiedMs: number | null };
type Language = "zh" | "en";

const GOALS_KEY = "growth-greenhouse.goals";
const RECORDS_KEY = "growth-greenhouse.records";
const REWARDS_KEY = "growth-greenhouse.rewards";
const PATH_KEY = "growth-greenhouse.patina-path";
const LanguageContext = createContext<Language>("zh");
const useLanguage = () => useContext(LanguageContext);
const text = (_language: Language, zh: string, _en: string) => zh;
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
const readList = <T,>(key: string, fallback: T[]) => {
  const value = read<unknown>(key, null);
  return Array.isArray(value) ? value as T[] : fallback;
};
const write = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
const minutes = (value: number, language: Language = "zh") => value < 60 ? `${Math.round(value)} ${text(language, "分钟", "min")}` : `${Math.floor(value / 60)} ${text(language, "小时", "hr")}${Math.round(value % 60) ? ` ${Math.round(value % 60)} ${text(language, "分钟", "min")}` : ""}`;
const stage = (units: number, completed = false, language: Language = "zh") => completed ? text(language, "已移入成长温室", "Moved to the growth greenhouse") : units >= 30 ? text(language, "开花结果", "Flowering") : units >= 15 ? text(language, "成熟植物", "Mature plant") : units >= 5 ? text(language, "茁壮幼苗", "Seedling") : units >= 1 ? text(language, "刚刚发芽", "Sprouted") : text(language, "一粒种子", "Seed");
const plantKindFor = (goal: Goal) => goal.plantKind ?? plantKinds[Array.from(goal.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % plantKinds.length];
const dateLabel = (value?: string, language: Language = "zh") => value ? new Date(`${value}T00:00:00`).toLocaleDateString(language === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "long", day: "numeric" }) : text(language, "尚未记录", "Not recorded");
const sessionTime = (value: number, language: Language = "zh") => new Date(value).toLocaleString(language === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const sessionDuration = (session: Session) => Math.max(0, (session.endTime ?? Date.now()) - session.startTime) / 60000;

function Plant({ units, completed = false, small = false, kind = "sprout" }: { units: number; completed?: boolean; small?: boolean; kind?: PlantKind }) {
  const language = useLanguage();
  const level = completed ? 5 : units >= 30 ? 4 : units >= 15 ? 3 : units >= 5 ? 2 : units >= 1 ? 1 : 0;
  return <div className={`plant plant-${level} plant-kind-${kind} ${small ? "plant-small" : ""}`} aria-label={`${stage(units, completed, language)}${language === "en" ? `, ${kind}` : `，${kind}`}`}>
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
  const currentDate = today();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = Math.max(start, monday().getTime());
  const matching = sessions.filter((session) => goal.exe && session.exeName.toLowerCase() === goal.exe.toLowerCase());
  const ownRecords = records.filter((record) => record.goalId === goal.id);
  const eligibleRecords = ownRecords.filter((record) => record.date >= goal.startDate && record.date <= currentDate);
  const manual = eligibleRecords.reduce((sum, record) => sum + record.minutes, 0);
  const manualDay = eligibleRecords.filter((record) => record.date === currentDate).reduce((sum, record) => sum + record.minutes, 0);
  const manualWeek = eligibleRecords.filter((record) => record.date >= dateText(new Date(weekStart))).reduce((sum, record) => sum + record.minutes, 0);
  const auto = unionMinutes(matching, start, now);
  const autoDay = unionMinutes(matching, Math.max(start, dayStart.getTime()), now);
  const autoWeek = unionMinutes(matching, weekStart, now);
  const total = auto + manual;
  const earnedUnits = Math.floor(total / UNIT);
  const fixedUnits = goal.status === "completed" && goal.completedUnits !== undefined ? goal.completedUnits : earnedUnits;
  return { total, today: autoDay + manualDay, week: autoWeek + manualWeek, units: fixedUnits, points: fixedUnits };
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
  const [goals, setGoals] = useState<Goal[]>(() => readList<Goal>(GOALS_KEY, []));
  const [records, setRecords] = useState<ManualRecord[]>(() => readList<ManualRecord>(RECORDS_KEY, []));
  const [rewards, setRewards] = useState<Reward[]>(() => readList<Reward>(REWARDS_KEY, [{ id: "first", name: "给今天的小奖励", cost: 4, annual: false, redeemed: false }]));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [path, setPath] = useState(() => localStorage.getItem(PATH_KEY) ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gardenSelectedId, setGardenSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<"goal" | "record" | "reward" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const language: Language = "zh";
  const stats = useMemo(() => new Map(goals.map((goal) => [goal.id, goalStats(goal, sessions, records)])), [goals, sessions, records]);
  const active = goals.filter((goal) => goal.status !== "completed");
  const completed = goals.filter((goal) => goal.status === "completed");
  const selected = active.find((goal) => goal.id === selectedId) ?? active[0] ?? null;
  const earnedPoints = Array.from(stats.values()).reduce((sum, stat) => sum + stat.points, 0);
  const redeemedPoints = rewards.filter((reward) => reward.redeemed).reduce((sum, reward) => sum + reward.cost, 0);
  const totalPoints = Math.max(0, earnedPoints - redeemedPoints);

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
      setLastSyncedAt(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text(language, "读取 Patina 失败", "Failed to read Patina"));
    } finally {
      setSyncing(false);
    }
  }, [goals, language, path]);

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
  const completeSelected = () => {
    if (!selected) return;
    const selectedStats = stats.get(selected.id);
    if (!selectedStats || selectedStats.units < 30) return;
    setGoals((current) => current.map((goal) => goal.id === selected.id ? { ...goal, status: "completed", completedAt: today(), completedUnits: selectedStats.units } : goal));
    setSelectedId(null);
  };
  const selectDatabaseFile = async (file: File) => {
    setError("");
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const nativePath = (file as File & { path?: string }).path;
      if (!nativePath) throw new Error(text(language, "当前窗口没有返回文件路径，请直接填写数据库路径", "This window did not return a file path. Enter the database path manually."));
        savePath(nativePath);
        return;
      }
      const response = await fetch("/api/patina/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file });
      if (!response.ok) throw new Error((await response.text()) || text(language, "无法读取选中的数据库", "Unable to read the selected database"));
      const selected = await response.json() as Source;
      savePath(selected.databasePath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text(language, "选择 Patina 数据库失败", "Failed to select the Patina database"));
    }
  };
  const go = (next: View) => { setView(next); setMenuOpen(false); };
  const pageName = view === "greenhouse" ? text(language, "温室", "Greenhouse") : view === "garden" ? text(language, "成长温室", "Growth Greenhouse") : view === "rewards" ? text(language, "奖励架", "Reward Shelf") : text(language, "数据源设置", "Data Source");
  const pageTitle = view === "greenhouse" ? text(language, "今天，也在生长", "Growing, one day at a time") : view === "garden" ? text(language, "成长温室", "Growth Greenhouse") : view === "rewards" ? text(language, "把期待放在这里", "Give your progress somewhere to go") : text(language, "连接你的时间", "Connect your time");

  return <LanguageContext.Provider value={language}><div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Sprout size={20} /></div><div><strong>Growth Greenhouse</strong><span>{text(language, "学习空间", "LEARNING SPACE")}</span></div></div>
      <nav><button className={view === "greenhouse" ? "active" : ""} onClick={() => go("greenhouse")}><Leaf size={18} /> {text(language, "我的温室", "My Greenhouse")}</button><button className={view === "garden" ? "active" : ""} onClick={() => go("garden")}><Warehouse size={18} /> {text(language, "成长温室", "Growth Greenhouse")} <b>{completed.length}</b></button><button className={view === "rewards" ? "active" : ""} onClick={() => go("rewards")}><Gift size={18} /> {text(language, "奖励架", "Reward Shelf")} <b>{totalPoints}</b></button></nav>
      <div className="sidebar-bottom"><div className="patina-status"><i className={source?.available ? "online" : ""} /><div><strong>{source?.available ? "Patina " + text(language, "已连接", "connected") : "Patina " + text(language, "未连接", "disconnected")}</strong><span>{source?.available ? text(language, "自动记录中", "Tracking automatically") : text(language, "等待数据源", "Waiting for data source")}</span></div></div><button className="settings-link" onClick={() => go("settings")}><Settings2 size={17} /> {text(language, "数据源设置", "Data Source")}</button></div>
    </aside>
      <main className="main"><header className="topbar"><div><span className="breadcrumb"><button className="breadcrumb-link" onClick={() => go("greenhouse")}>{text(language, "我的空间", "My Space")}</button><ChevronRight size={14} /><button className="breadcrumb-link" onClick={() => go(view)}>{pageName}</button></span><h1>{pageTitle}</h1></div><div className="top-actions">{view === "greenhouse" ? <div className="points"><Award size={17} /><strong>{totalPoints}</strong><span>{text(language, "成长点", "points")}</span></div> : null}<div className="menu-wrap"><button className="menu-button" title={text(language, "打开菜单", "Open menu")} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>{menuOpen ? <div className="menu-popover"><button onClick={() => go("greenhouse")}><Leaf size={15} /> {text(language, "我的温室", "My Greenhouse")}</button><button onClick={() => go("garden")}><Warehouse size={15} /> {text(language, "成长温室", "Growth Greenhouse")}</button><button onClick={() => go("rewards")}><Gift size={15} /> {text(language, "奖励架", "Reward Shelf")}</button><button onClick={() => go("settings")}><Settings2 size={15} /> {text(language, "数据源设置", "Data Source")}</button></div> : null}</div></div></header>
      {error ? <div className="alert"><CircleHelp size={16} /> {error}<button onClick={() => setError("")}><X size={15} /></button></div> : null}
      {view === "greenhouse" ? <><section className="welcome-banner"><div><span className="section-label">{text(language, "本周", "THIS WEEK")}</span><h2>{active.length ? text(language, "你的温室正在生长", "Your greenhouse is growing") : text(language, "先种下第一个目标", "Plant your first goal")}</h2><p>{active.length ? text(language, `正在照料 ${active.length} 个目标。每 ${UNIT} 分钟，留下一个成长单位。`, `Caring for ${active.length} goal${active.length === 1 ? "" : "s"}. Every ${UNIT} minutes leaves one growth unit.`) : text(language, "从一件你真正想学的事开始，温室会记住每一步。", "Start with something you genuinely want to learn. The greenhouse will remember every step.")}</p><div className="banner-actions"><button className="primary" onClick={() => setModal("goal")}><Plus size={16} /> {text(language, "种下新目标", "Plant a goal")}</button><button className="ghost" onClick={() => setModal("record")} disabled={!goals.length}><Clock3 size={16} /> {text(language, "手动记录", "Log learning")}</button></div></div><div className="banner-scene"><div className="sun" /><div className="cloud cloud-a" /><div className="cloud cloud-b" /><div className="ground" /><div className="scene-glass glass-a" /><div className="scene-glass glass-b" /><Plant kind={active[0] ? plantKindFor(active[0]) : "flower"} units={active[0] ? stats.get(active[0].id)?.units ?? 0 : 15} /></div></section><div className="section-heading"><div><span className="section-label">{text(language, "我的植物", "YOUR PLANTS")}</span><h2>{text(language, "正在培育", "Growing now")}</h2></div><button className="text-button" onClick={() => setModal("goal")}><Plus size={16} /> {text(language, "添加目标", "Add goal")}</button></div><section className="plant-grid">{active.length ? active.map((goal) => <GoalCard key={goal.id} goal={goal} stat={stats.get(goal.id)!} selected={selected?.id === goal.id} onClick={() => setSelectedId(goal.id)} />) : <EmptyState onClick={() => setModal("goal")} />}</section>{selected ? <Detail goal={selected} stat={stats.get(selected.id)!} onRecord={() => setModal("record")} onPause={() => setGoals((current) => current.map((goal) => goal.id === selected.id ? { ...goal, status: goal.status === "paused" ? "active" : "paused" } : goal))} onComplete={completeSelected} /> : null}<section className="lower-grid"><Garden completed={completed} onOpen={() => go("garden")} /><MiniRewards rewards={rewards} points={totalPoints} onOpen={() => go("rewards")} /></section></> : view === "garden" ? <CompletedGarden completed={completed} selectedId={gardenSelectedId} onSelect={setGardenSelectedId} onBack={() => go("greenhouse")} stats={stats} /> : view === "rewards" ? <Rewards rewards={rewards} points={totalPoints} onAdd={() => setModal("reward")} onRedeem={(id) => { const reward = rewards.find((item) => item.id === id); if (reward && !reward.redeemed && totalPoints >= reward.cost) setRewards((current) => current.map((item) => item.id === id ? { ...item, redeemed: true } : item)); }} /> : <Settings path={path} source={source} sessions={sessions} lastSyncedAt={lastSyncedAt} onSave={savePath} onFileSelect={selectDatabaseFile} />}
    </main>{modal ? <Modal onClose={() => setModal(null)}>{modal === "goal" ? <GoalForm sessions={sessions} goals={goals} onSubmit={addGoal} /> : modal === "record" ? <RecordForm goals={goals} selectedId={selected?.id} onSubmit={addRecord} /> : <RewardForm onSubmit={addReward} />}</Modal> : null}
  </div></LanguageContext.Provider>;
}

function GoalCard({ goal, stat, selected, onClick }: { goal: Goal; stat: ReturnType<typeof goalStats>; selected: boolean; onClick: () => void }) { const language = useLanguage(); const percent = goal.weekly ? Math.min(100, stat.week / goal.weekly * 100) : 0; return <button className={`plant-card ${selected ? "selected" : ""}`} onClick={onClick}><div className="card-plant"><Plant kind={plantKindFor(goal)} units={stat.units} /></div><div className="card-info"><div className="card-title"><strong>{goal.title}</strong><span>{stage(stat.units, false, language)}</span></div><p>{goal.app || text(language, "手动记录", "Manual log")}</p><div className="progress"><i style={{ width: `${percent}%` }} /></div><div className="card-meta"><span>{text(language, "本周", "This week")} {minutes(stat.week, language)}</span><span>{stat.units} {text(language, "单位", "units")}</span></div></div></button>; }
function EmptyState({ onClick }: { onClick: () => void }) { const language = useLanguage(); return <div className="empty-state"><div><Sprout size={24} /></div><strong>{text(language, "温室还没有植物", "Your greenhouse is empty")}</strong><span>{text(language, "创建一个目标，开始留下你的第一片叶子。", "Create a goal and leave your first leaf.")}</span><button className="secondary" onClick={onClick}><Plus size={15} /> {text(language, "创建目标", "Create goal")}</button></div>; }
  function Detail({ goal, stat, onRecord, onPause, onComplete }: { goal: Goal; stat: ReturnType<typeof goalStats>; onRecord: () => void; onPause: () => void; onComplete: () => void }) { const language = useLanguage(); const todayPercent = goal.daily ? Math.min(100, stat.today / goal.daily * 100) : 0; return <section className="detail-panel"><div className="detail-copy"><span className="section-label">{text(language, "当前照料", "CURRENT CARE")}</span><h2>{goal.title}</h2><p>{goal.description || text(language, "每天照料一点，目标就会慢慢长大。", "A little care each day helps the goal grow.")}</p><div className="detail-plant"><Plant kind={plantKindFor(goal)} units={stat.units} /><div><strong>{stage(stat.units, false, language)}</strong><span>{stat.units < 30 ? text(language, `再积累 ${30 - stat.units} 个成长单位，迎来下一阶段`, `${30 - stat.units} more growth units to reach the next stage`) : text(language, "这株植物已经准备好开花了", "This plant is ready to flower")}</span></div></div></div><div className="detail-right"><div className="metric"><span>{text(language, "今日学习", "Today")}</span><strong>{minutes(stat.today, language)}</strong><div className="metric-bar"><i style={{ width: `${todayPercent}%` }} /></div><small>{text(language, "目标", "Target")} {minutes(goal.daily, language)}</small></div><div className="metric"><span>{text(language, "本周积累", "This week")}</span><strong>{minutes(stat.week, language)}</strong><small>{text(language, "目标", "Target")} {minutes(goal.weekly, language)}</small></div><div className="metric"><span>{text(language, "成长单位", "Growth units")}</span><strong>{stat.units}</strong><small>{text(language, "每 25 分钟 +1", "+1 every 25 minutes")}</small></div><div className="detail-buttons"><button className="secondary" onClick={onRecord}><Clock3 size={15} /> {text(language, "补记学习", "Log learning")}</button>{stat.units >= 30 ? <button className="primary" onClick={onComplete}><Flower2 size={15} /> {text(language, "移入成长温室", "Move to the growth greenhouse")}</button> : <button className="quiet-icon" onClick={onPause} title={goal.status === "paused" ? text(language, "恢复目标", "Resume goal") : text(language, "暂停目标", "Pause goal")}>{goal.status === "paused" ? <RefreshCw size={16} /> : <Target size={16} />}</button>}</div></div></section>; }
 function Garden({ completed, onOpen }: { completed: Goal[]; onOpen: () => void }) { const language = useLanguage(); return <button className="panel garden garden-trigger" onClick={onOpen}><div className="panel-heading"><div><span className="section-label">{text(language, "成长温室", "GROWTH GREENHOUSE")}</span><h2>{text(language, "已完成的目标", "Completed goals")}</h2></div><Warehouse size={19} /></div>{completed.length ? <div className="garden-row">{completed.slice(0, 4).map((goal) => <div key={goal.id}><Plant kind={plantKindFor(goal)} units={30} completed small /><span>{goal.title}</span></div>)}</div> : <div className="garden-empty"><div className="fence" /><span>{text(language, "完成一株植物，它就会来到这里。", "Finish a plant and it will come here.")}</span></div>}<span className="garden-cta">{text(language, "进入成长温室", "Open growth greenhouse")} <ChevronRight size={14} /></span></button>; }
 function CompletedGarden({ completed, selectedId, onSelect, onBack, stats }: { completed: Goal[]; selectedId: string | null; onSelect: (id: string) => void; onBack: () => void; stats: Map<string, ReturnType<typeof goalStats>> }) { const language = useLanguage(); const selected = completed.find((goal) => goal.id === selectedId) ?? null; return <div className="page-stack garden-page"><div className="page-intro garden-page-intro"><button className="back-button" onClick={onBack}><ChevronLeft size={15} /> {text(language, "返回我的温室", "Back to greenhouse")}</button><span className="section-label">{text(language, "成长温室", "GROWTH GREENHOUSE")}</span><h2>{text(language, "每一盆，都是完成过的事", "Every plant marks something you finished")}</h2><p>{completed.length ? text(language, `这里收藏着 ${completed.length} 个已经完成的目标。点击一盆植物，查看它留下的时间。`, `${completed.length} completed goal${completed.length === 1 ? "" : "s"} live here. Select a plant to review its time.`) : text(language, "当一个目标完成，它会从培育区搬到这里。", "Completed goals move here from the greenhouse.")}</p></div><section className="garden-scene"><div className="scene-roof" /><div className="scene-sun" /><div className="scene-spark spark-one" /><div className="scene-spark spark-two" /><div className="garden-bench" /><div className="completed-plant-grid">{completed.length ? completed.map((goal) => <button className={`garden-plant ${selected?.id === goal.id ? "selected" : ""}`} key={goal.id} onClick={() => onSelect(goal.id)}><Plant kind={plantKindFor(goal)} units={30} completed /><strong>{goal.title}</strong><span>{dateLabel(goal.completedAt, language)}</span></button>) : <div className="garden-scene-empty"><Warehouse size={28} /><strong>{text(language, "这里还没有完成的植物", "No completed plants yet")}</strong><span>{text(language, "先回到温室，照料一个目标吧。", "Return to the greenhouse and care for a goal.")}</span><button className="secondary" onClick={onBack}><ChevronLeft size={15} /> {text(language, "返回培育区", "Back to growing")}</button></div>}</div></section>{selected ? <section className="panel garden-detail"><div><span className="section-label">{text(language, "植物记录", "PLANT RECORD")}</span><h2>{selected.title}</h2><p>{selected.description || text(language, "这段学习没有留下额外描述。", "No additional description was recorded.")}</p><dl><div><dt>{text(language, "完成日期", "Completed")}</dt><dd>{dateLabel(selected.completedAt, language)}</dd></div><div><dt>{text(language, "开始日期", "Started")}</dt><dd>{dateLabel(selected.startDate, language)}</dd></div><div><dt>{text(language, "计划目标", "Weekly target")}</dt><dd>{text(language, "每周", "Per week")} {minutes(selected.weekly, language)}</dd></div><div><dt>{text(language, "学习软件", "Learning app")}</dt><dd>{selected.app || text(language, "手动记录", "Manual log")}</dd></div><div><dt>{text(language, "累计成长", "Growth")}</dt><dd>{stats.get(selected.id)?.units ?? 0} {text(language, "个单位", "units")}</dd></div></dl></div><div className="garden-detail-plant"><Plant kind={plantKindFor(selected)} units={30} completed /></div></section> : null}</div>; }
function MiniRewards({ rewards, points, onOpen }: { rewards: Reward[]; points: number; onOpen: () => void }) { const language = useLanguage(); return <section className="panel mini-rewards"><div className="panel-heading"><div><span className="section-label">{text(language, "奖励架", "REWARD SHELF")}</span><h2>{text(language, "奖励架", "Reward shelf")}</h2></div><button className="text-button" onClick={onOpen}>{text(language, "查看全部", "View all")} <ChevronRight size={15} /></button></div>{rewards.slice(0, 2).map((reward) => <div className="mini-reward" key={reward.id}><Gift size={17} /><div><strong>{reward.name}</strong><span>{reward.annual ? text(language, "年度奖励", "Annual reward") : text(language, "期待中的小奖励", "Something to look forward to")}</span></div><b>{reward.redeemed ? text(language, "已兑换", "Redeemed") : `${reward.cost} ${text(language, "点", "pts")}`}</b></div>)}<div className="mini-points"><Award size={16} /> {text(language, "现在有", "You have")} <strong>{points} {text(language, "点", "pts")}</strong></div></section>; }
function Rewards({ rewards, points, onAdd, onRedeem }: { rewards: Reward[]; points: number; onAdd: () => void; onRedeem: (id: string) => void }) { const language = useLanguage(); return <div className="page-stack"><div className="page-intro"><span className="section-label">{text(language, "奖励架", "REWARD SHELF")}</span><p>{text(language, "学习留下的积累，可以换成你真正期待的东西。", "Turn your learning into something you genuinely look forward to.")}</p><div className="big-points"><Award size={22} /><strong>{points}</strong><span>{text(language, "可用成长点", "available points")}</span></div><button className="primary" onClick={onAdd}><Plus size={16} /> {text(language, "添加奖励", "Add reward")}</button></div><section className="panel reward-list">{rewards.map((reward) => <div className="reward-row" key={reward.id}><div className="reward-icon"><Gift size={20} /></div><div><strong>{reward.name}</strong><span>{reward.annual ? text(language, "年度奖励", "Annual reward") : text(language, "给今天的小奖励", "A small reward")}</span></div><button className="secondary" disabled={reward.redeemed || points < reward.cost} onClick={() => onRedeem(reward.id)}>{reward.redeemed ? <><Check size={14} /> {text(language, "已兑换", "Redeemed")}</> : `${reward.cost} ${text(language, "点兑换", "pts to redeem")}`}</button></div>)}</section></div>; }
 type SettingsProps = { path: string; source: Source | null; sessions: Session[]; lastSyncedAt: number | null; onSave: (path: string) => void; onFileSelect: (file: File) => Promise<void> };
 function Settings({ path, source, sessions, lastSyncedAt, onSave, onFileSelect }: SettingsProps) {
   const language = useLanguage();
   const title = source?.available ? (source.installed ? text(language, "Patina 已连接", "Patina connected") : text(language, "已找到 Patina 数据库", "Patina database found")) : text(language, "Patina 未连接", "Patina disconnected");
   const detail = source?.available ? text(language, `${source.installed ? "正在自动读取" : "可以读取历史记录，未检测到 Patina 程序"} · 最近同步 ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "等待中"}`, `${source.installed ? "Reading automatically" : "History is available, but the Patina app was not found"} · Last sync ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "waiting"}`) : text(language, "请确认 Patina 已安装并有数据", "Make sure Patina is installed and has data");
   return <div className="settings-wrapper"><div className="settings-sync-strip" role="status"><i className={source?.available ? "online" : ""} /><div><strong>{title}</strong><span>{detail}</span></div></div><SettingsContent path={path} source={source} sessions={sessions} lastSyncedAt={lastSyncedAt} onSave={onSave} onFileSelect={onFileSelect} /></div>;
 }
 function SettingsContent({ path, source, sessions, lastSyncedAt, onSave, onFileSelect }: SettingsProps) {
   const language = useLanguage();
   const [value, setValue] = useState(path);
   useEffect(() => setValue(path), [path]);
  const recent = [...sessions].sort((a, b) => b.startTime - a.startTime).slice(0, 12);
  const totalMinutes = sessions.reduce((sum, session) => sum + sessionDuration(session), 0);
  return <div className="page-stack settings-page"><div className="page-intro"><span className="section-label">{text(language, "数据源", "DATA SOURCE")}</span><h2>{text(language, "让 Patina 负责记录时间", "Let Patina track the time")}</h2><p>{text(language, "网页通过本机只读接口读取已安装 Patina 的 sessions 数据；Tauri 版本使用同一条读取逻辑。", "The preview reads Patina sessions through a local read-only adapter; the Tauri build uses the same logic.")}</p></div><section className="panel settings-panel"><div className="settings-state"><i className={source?.available ? "online" : ""} /><div><strong>{source?.available ? text(language, "已连接 Patina", "Patina connected") : text(language, "未连接 Patina", "Patina disconnected")}</strong><span>{source?.available ? text(language, `数据库最近更新于 ${source.lastModifiedMs ? new Date(source.lastModifiedMs).toLocaleTimeString() : "刚刚"}`, `Database last updated ${source.lastModifiedMs ? new Date(source.lastModifiedMs).toLocaleTimeString() : "just now"}`) : text(language, "请确认 Patina 已安装并有数据", "Make sure Patina is installed and has data")}</span></div></div><div className="path-hints"><div><span>{text(language, "Patina 程序通常位于", "Patina is usually at")}</span><code>%LOCALAPPDATA%\Patina\Patina.exe</code></div><div><span>{text(language, "Patina 数据库通常位于", "Patina database is usually at")}</span><code>%APPDATA%\Patina\patina.db</code></div></div><label>{text(language, "Patina 数据库路径", "Patina database path")}<span>{text(language, "默认路径：%APPDATA%\Patina\patina.db", "Default: %APPDATA%\Patina\patina.db")}</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={text(language, "留空使用默认路径", "Leave empty for the default path")} /></label><div className="settings-actions"><button className="primary" onClick={() => onSave(value)}><Check size={15} /> {text(language, "保存路径", "Save path")}</button><label className="file-picker secondary"><FolderOpen size={15} /> {text(language, "从资源管理器选择", "Choose in Explorer")}<input type="file" accept=".db,.sqlite,.sqlite3" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFileSelect(file); event.currentTarget.value = ""; }} /></label></div>{source?.databasePath ? <code className="selected-path">{text(language, "当前读取：", "Reading: ")}{source.databasePath}</code> : null}</section><section className="panel database-records"><div className="panel-heading"><div><span className="section-label">{text(language, "Patina 会话", "PATINA SESSIONS")}</span><h2>{text(language, "数据库记录", "Database records")}</h2></div><Database size={19} /></div><div className="record-summary"><strong>{sessions.length}</strong><span>{text(language, "条记录", "records")}</span><b>{minutes(totalMinutes, language)}</b><span>{text(language, "读取范围内总时长", "total in range")}</span></div>{recent.length ? <div className="records-table"><div className="records-row records-head"><span>{text(language, "应用", "App")}</span><span>{text(language, "开始时间", "Started")}</span><span>{text(language, "结束时间", "Ended")}</span><span>{text(language, "时长", "Duration")}</span></div>{recent.map((session) => <div className="records-row" key={session.id}><strong title={session.exeName}>{session.appName || session.exeName}</strong><span>{sessionTime(session.startTime, language)}</span><span>{session.endTime ? sessionTime(session.endTime, language) : text(language, "进行中", "Active")}</span><span>{minutes(sessionDuration(session), language)}</span></div>)}</div> : <div className="records-empty"><Database size={22} /><span>{text(language, "暂时没有读到 sessions 记录", "No sessions found yet")}</span><small>{text(language, "请确认数据库路径正确，并让 Patina 先产生一些活动记录。", "Check the database path and let Patina record some activity first.")}</small></div>}<p className="records-note">{text(language, "网页当前展示最近 90 天的 Patina sessions，数据只读，不会写回原数据库。", "The preview shows Patina sessions from the last 90 days. Data is read-only and never written back.")}</p></section></div>;
}
function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) { const language = useLanguage(); return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal"><button className="modal-close" onClick={onClose} aria-label={text(language, "关闭", "Close")}><X size={18} /></button>{children}</div></div>; }
function GoalForm({ sessions, goals, onSubmit }: { sessions: Session[]; goals: Goal[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const language = useLanguage(); const apps = Array.from(new Map(sessions.map((session) => [session.exeName.toLowerCase(), { exe: session.exeName, app: session.appName || session.exeName }])).values()).filter((item) => !goals.some((goal) => goal.exe.toLowerCase() === item.exe.toLowerCase() && goal.status !== "completed")); return <form className="form" onSubmit={onSubmit}><span className="section-label">{text(language, "新植物", "NEW PLANT")}</span><h2>{text(language, "种下一个目标", "Plant a goal")}</h2><p>{text(language, "不用想得太远，只填写你现在真正想学的事。", "Keep it simple. Start with what you genuinely want to learn.")}</p><label>{text(language, "目标名称", "Goal name")}<input name="title" required autoFocus placeholder={text(language, "例如：学会 Blender 建模", "e.g. Learn Blender modeling")} /></label><label>{text(language, "一句话描述", "Short description")}<input name="description" placeholder={text(language, "例如：做出第一个可以打印的模型", "e.g. Make a first printable model")} /></label><div className="form-grid"><label>{text(language, "每周目标（分钟）", "Weekly target (minutes)")}<input name="weekly" type="number" min="25" step="25" defaultValue="200" /></label><label>{text(language, "每日建议（分钟）", "Daily suggestion (minutes)")}<input name="daily" type="number" min="0" step="5" defaultValue="25" /></label></div><label>{text(language, "开始日期", "Start date")}<input name="startDate" type="date" defaultValue={today()} /></label><label>{text(language, "关联学习软件", "Learning app")}<span className="hint">{text(language, "可选。选择后自动累计 Patina 中的有效时长。", "Optional. Effective time from Patina will be counted automatically.")}</span><select name="exe" defaultValue="" onChange={(event) => { const option = event.currentTarget.selectedOptions[0]; const input = event.currentTarget.form?.elements.namedItem("app") as HTMLInputElement | null; if (input) input.value = option?.dataset.app ?? ""; }}><option value="" data-app="">{text(language, "暂不关联，之后手动记录", "No app yet; use manual logs")}</option>{apps.map((app) => <option key={app.exe} value={app.exe} data-app={app.app}>{app.app}</option>)}</select><input type="hidden" name="app" /></label><button className="primary form-submit"><Sprout size={16} /> {text(language, "种下目标", "Plant goal")}</button></form>; }
function RecordForm({ goals, selectedId, onSubmit }: { goals: Goal[]; selectedId?: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const language = useLanguage(); return <form className="form" onSubmit={onSubmit}><span className="section-label">{text(language, "手动记录", "MANUAL SESSION")}</span><h2>{text(language, "留下学习记录", "Log learning")}</h2><p>{text(language, "有些学习不在电脑上，也值得被温室记住。", "Learning also happens away from the computer. Keep a record of it here.")}</p><label>{text(language, "学习目标", "Learning goal")}<select name="goalId" defaultValue={selectedId ?? goals[0]?.id} required>{goals.filter((goal) => goal.status !== "completed").map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label><div className="form-grid"><label>{text(language, "学习日期", "Date")}<input name="date" type="date" defaultValue={today()} /></label><label>{text(language, "学习时长（分钟）", "Learning time (minutes)")}<input name="minutes" type="number" min="1" step="5" defaultValue="25" /></label></div><button className="primary form-submit"><Check size={16} /> {text(language, "记录这次学习", "Save learning")}</button></form>; }
function RewardForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const language = useLanguage(); return <form className="form" onSubmit={onSubmit}><span className="section-label">{text(language, "新奖励", "NEW REWARD")}</span><h2>{text(language, "放一个奖励上架", "Add a reward")}</h2><p>{text(language, "让积累有一个你期待的去处。", "Give your progress somewhere to go.")}</p><label>{text(language, "奖励名称", "Reward name")}<input name="name" required autoFocus placeholder={text(language, "例如：买一套新的模型素材", "e.g. Buy a new model pack")} /></label><label>{text(language, "需要成长点", "Points needed")}<input name="cost" type="number" min="1" defaultValue="10" /></label><label className="check-label"><input name="annual" type="checkbox" /> {text(language, "这是我的年度奖励", "This is an annual reward")}</label><button className="primary form-submit"><Gift size={16} /> {text(language, "放上奖励架", "Add to shelf")}</button></form>; }
