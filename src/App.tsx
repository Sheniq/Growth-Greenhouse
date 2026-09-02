import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BarChart3, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, Droplets, Flower2,
  FolderOpen, Gift, Leaf, Menu, Monitor, Plus, RefreshCw, Settings2, Sprout, Target, Trash2, TrendingUp, Trees, X,
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
type AppCategory = "learning" | "game" | "neutral";
type AppCategories = Record<string, AppCategory>;

const GOALS_KEY = "growth-greenhouse.goals";
const RECORDS_KEY = "growth-greenhouse.records";
const REWARDS_KEY = "growth-greenhouse.rewards";
const PATH_KEY = "growth-greenhouse.patina-path";
const APP_CATEGORIES_KEY = "growth-greenhouse.app-categories";
const LanguageContext = createContext<Language>("zh");
const useLanguage = () => useContext(LanguageContext);
const text = (_language: Language, zh: string, _en: string) => zh;
const UNIT = 25;
const WATER_DROP_INTERVAL = 60 * 60 * 1000;
const PATINA_RELEASES_URL = "https://github.com/Ceceliaee/patina/releases";
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
const formatPoints = (value: number) => value.toFixed(1);
const formatSignedPoints = (value: number) => `${value > 0 ? "+" : ""}${formatPoints(value)}`;
const MAX_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
type TimeRange = { from: number; to: number };
const categoryWaterDrops = (sessions: Session[], categories: AppCategories) => {
  const categoryRanges: Record<"learning" | "game", TimeRange[]> = { learning: [], game: [] };
  for (const session of sessions) {
    const category = categories[session.exeName.toLowerCase()] ?? "neutral";
    if (category !== "learning" && category !== "game") continue;
    const interval = sessionInterval(session);
    if (interval) categoryRanges[category].push(interval);
  }
  const learningMilliseconds = mergeTimeRanges(categoryRanges.learning).reduce((total, range) => total + range.to - range.from, 0);
  const gameMilliseconds = mergeTimeRanges(categoryRanges.game).reduce((total, range) => total + range.to - range.from, 0);
  const learningDrops = Math.floor(learningMilliseconds / WATER_DROP_INTERVAL);
  const gameDrops = Math.floor(gameMilliseconds / WATER_DROP_INTERVAL);
  return { learningDrops, gameDrops, delta: learningDrops - gameDrops };
};
const manualWaterDrops = (records: ManualRecord[], goals: Goal[]) => {
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const eligibleMinutes = records.reduce((total, record) => {
    const goal = goalById.get(record.goalId);
    if (!goal || record.date < goal.startDate || record.date > today()) return total;
    return total + Math.max(0, record.minutes);
  }, 0);
  return Math.floor(eligibleMinutes * 60000 / WATER_DROP_INTERVAL);
};
const plantProgress = (totalMinutes: number) => Math.min(1, Math.max(0, totalMinutes / (UNIT * 30)));
const wholeMinutes = (value: FormDataEntryValue | null, fallback: number, allowZero = false) => {
  const parsed = Number(String(value ?? "").trim());
  const minimum = allowZero ? 0 : 1;
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
};
const stage = (units: number, completed = false, language: Language = "zh") => completed ? text(language, "已移入成长温室", "Moved to the growth greenhouse") : units >= 30 ? text(language, "开花结果", "Flowering") : units >= 15 ? text(language, "成熟植物", "Mature plant") : units >= 5 ? text(language, "茁壮幼苗", "Seedling") : units >= 1 ? text(language, "刚刚发芽", "Sprouted") : text(language, "一粒种子", "Seed");
const plantKindFor = (goal: Goal) => goal.plantKind ?? plantKinds[Array.from(goal.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % plantKinds.length];
const dateLabel = (value?: string, language: Language = "zh") => value ? new Date(`${value}T00:00:00`).toLocaleDateString(language === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "long", day: "numeric" }) : text(language, "尚未记录", "Not recorded");
const sessionTime = (value: number, language: Language = "zh") => new Date(value).toLocaleString(language === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const sessionInterval = (session: Session, now = Date.now()): TimeRange | null => {
  const start = Number(session.startTime);
  if (!Number.isFinite(start) || start <= 0) return null;
  const storedDuration = Number(session.durationMs);
  const end = Number(session.endTime);
  const endedDuration = Number.isFinite(end) && end > start ? end - start : 0;
  let duration = Number.isFinite(storedDuration) && storedDuration > 0 ? storedDuration : endedDuration;
  // Patina stores duration in milliseconds. If a stale row reports more time
  // than its recorded end boundary, the bounded interval is the reliable value.
  if (endedDuration > 0) duration = Math.min(duration, endedDuration);
  if (!duration && session.endTime === null && session.durationMs === null) duration = Math.max(0, now - start);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SESSION_DURATION_MS) return null;
  return { from: start, to: start + duration };
};
const sessionEnd = (session: Session, now = Date.now()) => sessionInterval(session, now)?.to ?? Number(session.startTime);
const sessionDuration = (session: Session) => Math.max(0, sessionEnd(session) - Number(session.startTime)) / 60000;
const formatUsageDuration = (milliseconds: number) => {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const remainderMinutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h${remainderMinutes ? ` ${remainderMinutes}m` : ""}`;
  return `${remainderMinutes}m`;
};

function Plant({ units, completed = false, small = false, kind = "sprout", progress }: { units: number; completed?: boolean; small?: boolean; kind?: PlantKind; progress?: number }) {
  const language = useLanguage();
  const level = completed ? 5 : units >= 30 ? 4 : units >= 15 ? 3 : units >= 5 ? 2 : units >= 1 ? 1 : 0;
  const growthProgress = completed ? 1 : Math.min(1, Math.max(0, progress ?? units / 30));
  const plantScale = 0.72 + growthProgress * 0.28;
  return <div className={`plant plant-${level} plant-kind-${kind} ${small ? "plant-small" : ""}`} style={{ "--plant-scale": plantScale } as CSSProperties} aria-label={`${stage(units, completed, language)}${language === "en" ? `, ${kind}` : `，${kind}`}`}>
    <div className="plant-halo" /><div className="plant-pot"><span /></div>
    {kind === "fern" ? <div className="fern-fronds"><i /><i /><i /><i /></div> : null}
    {kind === "cactus" ? <div className="cactus-body"><i /><b /></div> : null}
    {kind !== "fern" && kind !== "cactus" ? <><div className="plant-stem" /><div className="plant-leaf plant-leaf-left" /><div className="plant-leaf plant-leaf-right" /></> : null}
    {kind === "flower" ? <div className="plant-flower"><Flower2 size={25} /></div> : null}
    {level === 0 ? <div className="plant-seed" /> : null}
    {completed && kind !== "cactus" ? <div className="plant-crown"><Sprout size={27} /></div> : null}
  </div>;
}

function mergeTimeRanges(ranges: TimeRange[]) {
  const sorted = ranges.filter((range) => range.to > range.from).sort((a, b) => a.from - b.from);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const current = merged[merged.length - 1];
    if (!current || range.from > current.to) merged.push({ ...range });
    else current.to = Math.max(current.to, range.to);
  }
  return merged;
}

function unionMinutes(sessions: Session[], from: number, to: number) {
  const ranges = sessions.map((session) => {
    const interval = clippedSession(session, from, to, to);
    return interval ? { from: interval.start, to: interval.end } : null;
  }).filter((range): range is TimeRange => range !== null);
  let total = 0;
  for (const range of mergeTimeRanges(ranges)) total += range.to - range.from;
  return total / 60000;
}

type UsageRangeKey = "today" | "recent7" | "recent30" | "recentYear" | "all" | "custom";
type UsageDisplayMode = "daily" | "total";
type UsageBucketMode = "day" | "month";
type UsageRange = { key: UsageRangeKey; from: number; to: number; mode: UsageBucketMode; label: string };
type UsageBucket = { key: string; label: string; from: number; to: number; milliseconds: number };
type AppUsage = { key: string; name: string; exeName: string; category: AppCategory; milliseconds: number; percentage: number; activeDays: number; trend: number[]; waterDrops: number };
type SoftwareUsageData = { range: UsageRange; totalMilliseconds: number; averageMilliseconds: number; activeDays: number; buckets: UsageBucket[]; apps: AppUsage[]; heatmap: UsageBucket[]; recentSessions: Session[] };

const localDayStart = (timestamp: number) => {
  const value = new Date(timestamp);
  value.setHours(0, 0, 0, 0);
  return value;
};

function addLocalDay(date: Date, amount = 1) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function addLocalMonth(date: Date, amount = 1) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addDaysToSet(set: Set<string>, from: number, to: number) {
  let cursor = localDayStart(from);
  while (cursor.getTime() < to) {
    set.add(dateText(cursor));
    cursor = addLocalDay(cursor);
  }
}

function usageBuckets(from: number, to: number, mode: UsageBucketMode): UsageBucket[] {
  const buckets: UsageBucket[] = [];
  const fromDate = new Date(from);
  let cursor = mode === "month" ? new Date(fromDate.getFullYear(), fromDate.getMonth(), 1) : localDayStart(from);
  while (cursor.getTime() < to) {
    const next = mode === "month" ? addLocalMonth(cursor) : addLocalDay(cursor);
    buckets.push({
      key: mode === "month" ? `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}` : dateText(cursor),
      label: mode === "month" ? cursor.toLocaleDateString("zh-CN", { year: "numeric", month: "short" }) : cursor.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
      from: cursor.getTime(),
      to: Math.min(to, next.getTime()),
      milliseconds: 0,
    });
    cursor = next;
  }
  return buckets;
}

function customDate(value: string, fallback: Date) {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return fallback;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function usageRange(key: UsageRangeKey, sessions: Session[], customFrom: string, customTo: string, now = Date.now()): UsageRange {
  const todayStart = localDayStart(now);
  let from = todayStart.getTime();
  let to = now;
  let mode: UsageBucketMode = "day";
  let label = "今天";
  if (key === "recent7") {
    from = addLocalDay(todayStart, -6).getTime(); label = "近 7 天";
  } else if (key === "recent30") {
    from = addLocalDay(todayStart, -29).getTime(); label = "近 30 天";
  } else if (key === "recentYear") {
    const yearAgo = new Date(todayStart); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    from = yearAgo.getTime(); mode = "month"; label = "近一年";
  } else if (key === "all") {
    const first = sessions.map((session) => sessionInterval(session)?.from).filter((value): value is number => value !== undefined).reduce((minimum, value) => Math.min(minimum, value), now);
    from = first === now ? todayStart.getTime() : localDayStart(first).getTime(); mode = "month"; label = "全部";
  } else if (key === "custom") {
    let startDate = customDate(customFrom, todayStart);
    let endDate = customDate(customTo, todayStart);
    if (endDate.getTime() < startDate.getTime()) [startDate, endDate] = [endDate, startDate];
    from = localDayStart(startDate.getTime()).getTime();
    const endOfDate = addLocalDay(localDayStart(endDate.getTime())).getTime();
    to = dateText(endDate) === dateText(todayStart) ? now : endOfDate;
    label = "自定义范围";
  }
  return { key, from, to: Math.max(from + 1, to), mode, label };
}

function clippedSession(session: Session, from: number, to: number, now = Date.now()) {
  const interval = sessionInterval(session, now);
  if (!interval) return null;
  const start = Math.max(from, interval.from);
  const end = Math.min(to, interval.to);
  return end > start ? { start, end } : null;
}

function addRangesToBuckets(ranges: TimeRange[], buckets: UsageBucket[]) {
  for (const range of ranges) {
    for (const bucket of buckets) {
      bucket.milliseconds += Math.max(0, Math.min(range.to, bucket.to) - Math.max(range.from, bucket.from));
    }
  }
}

function totalRangeMilliseconds(ranges: TimeRange[]) {
  return ranges.reduce((total, range) => total + range.to - range.from, 0);
}

function softwareUsage(sessions: Session[], key: UsageRangeKey, customFrom: string, customTo: string, categories: AppCategories): SoftwareUsageData {
  const range = usageRange(key, sessions, customFrom, customTo);
  const buckets = usageBuckets(range.from, range.to, range.mode);
  const clippedRecords: { session: Session; range: TimeRange }[] = [];
  for (const session of sessions) {
    const clipped = clippedSession(session, range.from, range.to);
    if (clipped) clippedRecords.push({ session, range: { from: clipped.start, to: clipped.end } });
  }

  // Patina sessions should be sequential, but merging here keeps malformed or overlapping rows from inflating totals.
  const overallRanges = mergeTimeRanges(clippedRecords.map((record) => record.range));
  const totalMilliseconds = totalRangeMilliseconds(overallRanges);
  const activeDays = new Set<string>();
  for (const rangeItem of overallRanges) addDaysToSet(activeDays, rangeItem.from, rangeItem.to);
  addRangesToBuckets(overallRanges, buckets);

  const apps = new Map<string, { name: string; exeName: string; ranges: TimeRange[] }>();
  for (const record of clippedRecords) {
    const appKey = record.session.exeName.toLowerCase() || record.session.appName.toLowerCase();
    const app = apps.get(appKey) ?? { name: record.session.appName || record.session.exeName, exeName: record.session.exeName, ranges: [] };
    app.ranges.push(record.range);
    apps.set(appKey, app);
  }
  const appList = Array.from(apps.entries()).map(([appKey, app]) => {
    const appRanges = mergeTimeRanges(app.ranges);
    const milliseconds = totalRangeMilliseconds(appRanges);
    const appActiveDays = new Set<string>();
    for (const rangeItem of appRanges) addDaysToSet(appActiveDays, rangeItem.from, rangeItem.to);
    const trend = new Array<number>(buckets.length).fill(0);
    for (const rangeItem of appRanges) {
      buckets.forEach((bucket, index) => { trend[index] += Math.max(0, Math.min(rangeItem.to, bucket.to) - Math.max(rangeItem.from, bucket.from)); });
    }
    const category = categories[appKey] ?? "neutral";
    const wholeHours = Math.floor(milliseconds / WATER_DROP_INTERVAL);
    return { key: appKey, name: app.name, exeName: app.exeName, category, milliseconds, percentage: totalMilliseconds ? Math.round(milliseconds / totalMilliseconds * 100) : 0, activeDays: appActiveDays.size, trend, waterDrops: category === "learning" ? wholeHours : category === "game" ? -wholeHours : 0 };
  }).filter((app) => app.milliseconds > 0).sort((a, b) => b.milliseconds - a.milliseconds);
  const rangeDays = Math.max(1, Math.ceil((range.to - range.from) / 86400000));
  const heatmapFrom = rangeDays > 371 ? addLocalDay(localDayStart(range.to), -364).getTime() : range.from;
  const heatmap = usageBuckets(heatmapFrom, range.to, "day");
  const heatmapRanges = mergeTimeRanges(sessions.map((session) => clippedSession(session, heatmapFrom, range.to)).filter((value): value is { start: number; end: number } => value !== null).map((value) => ({ from: value.start, to: value.end })));
  addRangesToBuckets(heatmapRanges, heatmap);
  const recentSessions = clippedRecords.map((record) => record.session).sort((a, b) => b.startTime - a.startTime || b.id - a.id).slice(0, 12);
  return { range, totalMilliseconds, averageMilliseconds: totalMilliseconds / Math.max(1, buckets.length), activeDays: activeDays.size, buckets, apps: appList, heatmap, recentSessions };
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
  const response = await fetch(`/api/patina/source${path ? `?path=${encodeURIComponent(path)}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error("网页本地接口无法连接，请确认正在运行 pnpm dev");
  return await response.json() as Source;
}

async function sessionSnapshot(since: number, until: number, path?: string): Promise<Session[]> {
  if ("__TAURI_INTERNALS__" in window) return invoke<Session[]>("read_patina_sessions", { sinceMs: since, untilMs: until, databasePath: path || null });
  const query = new URLSearchParams({ sinceMs: String(since), untilMs: String(until) });
  if (path) query.set("path", path);
  const response = await fetch(`/api/patina/sessions?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error((await response.text()) || "读取 Patina 会话失败");
  return await response.json() as Session[];
}

export default function App() {
  if (window.location.hash === "#widget") return <Widget />;
  const [view, setView] = useState<View>("greenhouse");
  const [goals, setGoals] = useState<Goal[]>(() => readList<Goal>(GOALS_KEY, []));
  const [records, setRecords] = useState<ManualRecord[]>(() => readList<ManualRecord>(RECORDS_KEY, []));
  const [rewards, setRewards] = useState<Reward[]>(() => readList<Reward>(REWARDS_KEY, [{ id: "first", name: "给今天的小奖励", cost: 4, annual: false, redeemed: false }]));
  const [appCategories, setAppCategories] = useState<AppCategories>(() => read<AppCategories>(APP_CATEGORIES_KEY, {}));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [path, setPath] = useState(() => localStorage.getItem(PATH_KEY) ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gardenSelectedId, setGardenSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null);
  const [modal, setModal] = useState<"goal" | "record" | "reward" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const syncRequest = useRef(0);
  const language: Language = "zh";
  const stats = useMemo(() => new Map(goals.map((goal) => [goal.id, goalStats(goal, sessions, records)])), [goals, sessions, records]);
  const categoryDrops = useMemo(() => categoryWaterDrops(sessions, appCategories), [sessions, appCategories]);
  const active = goals.filter((goal) => goal.status !== "completed");
  const completed = goals.filter((goal) => goal.status === "completed");
  const selected = active.find((goal) => goal.id === selectedId) ?? active[0] ?? null;
  const manualLearningDrops = useMemo(() => manualWaterDrops(records, goals), [records, goals]);
  const redeemedPoints = rewards.filter((reward) => reward.redeemed).reduce((sum, reward) => sum + reward.cost, 0);
  const totalPoints = Math.max(0, categoryDrops.learningDrops + manualLearningDrops - categoryDrops.gameDrops - redeemedPoints);

  const sync = useCallback(async () => {
    const requestId = ++syncRequest.current;
    setSyncing(true);
    setError("");
    let current: Source | null = null;
    try {
      current = await sourceSnapshot(path);
      if (!current.installed) {
        if (requestId !== syncRequest.current) return;
        setSource(current);
        setSessions([]);
        setLastSyncedAt(null);
        return;
      }
      if (!current.available) {
        if (requestId !== syncRequest.current) return;
        setSource(current);
        setSessions([]);
        setLastSyncedAt(null);
        return;
      }
      const nextSessions = await sessionSnapshot(0, Date.now(), current.databasePath);
      if (requestId !== syncRequest.current) return;
      setSource(current);
      setSessions(nextSessions);
      setLastSyncedAt(Date.now());
    } catch (cause) {
      if (requestId === syncRequest.current) {
        if (current) setSource(current);
        setError(cause instanceof Error ? `Patina 同步失败，保留上次数据：${cause.message}` : text(language, "Patina 同步失败，保留上次数据", "Failed to read Patina"));
      }
    } finally {
      if (requestId === syncRequest.current) setSyncing(false);
    }
  }, [path]);

  useEffect(() => {
    void sync();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void sync(); }, 5000);
    const refresh = () => { if (document.visibilityState === "visible") void sync(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [sync]);
  useEffect(() => { write(GOALS_KEY, goals); }, [goals]);
  useEffect(() => { write(RECORDS_KEY, records); }, [records]);
  useEffect(() => { write(REWARDS_KEY, rewards); }, [rewards]);
  useEffect(() => { write(APP_CATEGORIES_KEY, appCategories); }, [appCategories]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(".menu-wrap")) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const addGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const exe = String(data.get("exe") ?? "");
    const goal: Goal = { id: crypto.randomUUID(), title: String(data.get("title") ?? "").trim() || "新的学习目标", description: String(data.get("description") ?? "").trim(), weekly: wholeMinutes(data.get("weekly"), 200), daily: wholeMinutes(data.get("daily"), 25, true), startDate: String(data.get("startDate") ?? today()) || today(), exe, app: String(data.get("app") ?? exe), status: "active", plantKind: plantKinds[goals.length % plantKinds.length] };
    setGoals((current) => [...current, goal]);
    setSelectedId(goal.id);
    setModal(null);
  };
  const addRecord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setRecords((current) => [...current, { id: crypto.randomUUID(), goalId: String(data.get("goalId") ?? ""), date: String(data.get("date") ?? today()) || today(), minutes: wholeMinutes(data.get("minutes"), 25) }]);
    setModal(null);
  };
  const addReward = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setRewards((current) => [...current, { id: crypto.randomUUID(), name: String(data.get("name") ?? "").trim() || "新奖励", cost: wholeMinutes(data.get("cost"), 10), annual: data.get("annual") === "on", redeemed: false }]);
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
  const deleteGoal = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setGoals((current) => current.filter((goal) => goal.id !== id));
    setRecords((current) => current.filter((record) => record.goalId !== id));
    setSelectedId((current) => current === id ? null : current);
    setGardenSelectedId((current) => current === id ? null : current);
    setDeleteTarget(null);
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
  const pageName = view === "greenhouse" ? text(language, "我的温室", "My Greenhouse") : view === "garden" ? text(language, "成长温室", "Growth Greenhouse") : view === "rewards" ? text(language, "奖励", "Rewards") : text(language, "数据源", "Data Source");
  const pageTitle = view === "greenhouse" ? text(language, "今天的学习", "Today's learning") : view === "garden" ? text(language, "成长温室", "Growth Greenhouse") : view === "rewards" ? text(language, "兑换奖励", "Redeem rewards") : text(language, "数据源", "Data Source");

  return <LanguageContext.Provider value={language}><div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Sprout size={20} /></div><div><strong>成长温室</strong><span>{text(language, "学习计划", "LEARNING SPACE")}</span></div></div>
      <nav><button className={view === "greenhouse" ? "active" : ""} onClick={() => go("greenhouse")}><Leaf size={18} /> {text(language, "我的温室", "My Greenhouse")}</button><button className={view === "garden" ? "active" : ""} onClick={() => go("garden")}><Trees size={18} /> {text(language, "成长温室", "Growth Greenhouse")} <b>{completed.length}</b></button><button className={view === "rewards" ? "active" : ""} onClick={() => go("rewards")}><Gift size={18} /> {text(language, "奖励", "Reward Shelf")} <b>{formatPoints(totalPoints)}</b></button></nav>
      <div className="sidebar-bottom"><div className="patina-status"><i className={source?.available && source.installed ? "online" : ""} /><div><strong>{source?.available && source.installed ? "Patina " + text(language, "已连接", "connected") : source && !source.installed ? "需要安装 Patina" : "Patina " + text(language, "未连接", "disconnected")}</strong><span>{source?.available && source.installed ? text(language, "正在读取活动", "Tracking automatically") : source && !source.installed ? "前往数据源查看安装方式" : text(language, "等待连接", "Waiting for data source")}</span></div></div><button className="settings-link" onClick={() => go("settings")}><Settings2 size={17} /> {text(language, "数据源", "Data Source")}</button></div>
    </aside>
      <main className="main"><header className="topbar"><div><span className="breadcrumb"><button className="breadcrumb-link" onClick={() => go("greenhouse")}>{text(language, "我的空间", "My Space")}</button><ChevronRight size={14} /><button className="breadcrumb-link" onClick={() => go(view)}>{pageName}</button></span><h1>{pageTitle}</h1></div><div className="top-actions">{view === "greenhouse" ? <div className="points"><Droplets size={17} /><strong>{formatPoints(totalPoints)}</strong><span>水滴</span></div> : null}<div className="menu-wrap"><button className="menu-button" title={text(language, "打开菜单", "Open menu")} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>{menuOpen ? <div className="menu-popover"><button onClick={() => go("greenhouse")}><Leaf size={15} /> {text(language, "我的温室", "My Greenhouse")}</button><button onClick={() => go("garden")}><Trees size={15} /> {text(language, "成长温室", "Growth Greenhouse")}</button><button onClick={() => go("rewards")}><Gift size={15} /> {text(language, "奖励", "Reward Shelf")}</button><button onClick={() => go("settings")}><Settings2 size={15} /> {text(language, "数据源", "Data Source")}</button></div> : null}</div></div></header>
      {error ? <div className="alert"><CircleHelp size={16} /> {error}<button onClick={() => setError("")}><X size={15} /></button></div> : null}
      {view === "greenhouse" ? <><section className="welcome-banner"><div><span className="section-label">{text(language, "本周进度", "THIS WEEK")}</span><h2>{active.length ? text(language, "一点一点，目标会长大", "Your greenhouse is growing") : text(language, "先种下第一个目标", "Plant your first goal")}</h2><p>{active.length ? text(language, `有 ${active.length} 个进行中的目标。每 ${UNIT} 分钟增加 1 个成长单位。`, `Caring for ${active.length} goal${active.length === 1 ? "" : "s"}. Every ${UNIT} minutes leaves one growth unit.`) : text(language, "从一件你真正想学的事开始。", "Start with something you genuinely want to learn.")}</p><div className="banner-actions"><button className="primary" onClick={() => setModal("goal")}><Plus size={16} /> {text(language, "创建目标", "Plant a goal")}</button><button className="ghost" onClick={() => setModal("record")} disabled={!goals.length}><Clock3 size={16} /> {text(language, "记录学习", "Log learning")}</button></div></div><div className="banner-scene"><div className="sun" /><div className="cloud cloud-a" /><div className="cloud cloud-b" /><div className="ground" /><div className="scene-glass glass-a" /><div className="scene-glass glass-b" /><Plant kind={active[0] ? plantKindFor(active[0]) : "flower"} units={active[0] ? stats.get(active[0].id)?.units ?? 0 : 15} progress={active[0] ? plantProgress(stats.get(active[0].id)?.total ?? 0) : 0.5} /></div></section><div className="section-heading"><div><span className="section-label">{text(language, "学习目标", "YOUR PLANTS")}</span><h2>{text(language, "进行中的目标", "Growing now")}</h2></div><button className="text-button" onClick={() => setModal("goal")}><Plus size={16} /> {text(language, "添加目标", "Add goal")}</button></div><section className="plant-grid">{active.length ? active.map((goal) => <GoalCard key={goal.id} goal={goal} stat={stats.get(goal.id)!} selected={selected?.id === goal.id} onClick={() => setSelectedId(goal.id)} />) : <EmptyState onClick={() => setModal("goal")} />}</section>{selected ? <Detail goal={selected} stat={stats.get(selected.id)!} onRecord={() => setModal("record")} onPause={() => setGoals((current) => current.map((goal) => goal.id === selected.id ? { ...goal, status: goal.status === "paused" ? "active" : "paused" } : goal))} onComplete={completeSelected} onDelete={() => setDeleteTarget(selected)} /> : null}<section className="lower-grid"><Garden completed={completed} onOpen={() => go("garden")} /><MiniRewards rewards={rewards} points={totalPoints} onOpen={() => go("rewards")} /></section></> : view === "garden" ? <CompletedGarden completed={completed} selectedId={gardenSelectedId} onSelect={setGardenSelectedId} onBack={() => go("greenhouse")} stats={stats} onDelete={(goal) => setDeleteTarget(goal)} /> : view === "rewards" ? <Rewards rewards={rewards} points={totalPoints} onAdd={() => setModal("reward")} onRedeem={(id) => { const reward = rewards.find((item) => item.id === id); if (reward && !reward.redeemed && totalPoints >= reward.cost) setRewards((current) => current.map((item) => item.id === id ? { ...item, redeemed: true } : item)); }} /> : <Settings path={path} source={source} sessions={sessions} syncing={syncing} appCategories={appCategories} manualLearningDrops={manualLearningDrops} onCategoryChange={(appKey, category) => setAppCategories((current) => ({ ...current, [appKey]: category }))} lastSyncedAt={lastSyncedAt} onSave={savePath} onFileSelect={selectDatabaseFile} />}
    </main>{modal ? <Modal onClose={() => setModal(null)}>{modal === "goal" ? <GoalForm sessions={sessions} goals={goals} onSubmit={addGoal} /> : modal === "record" ? <RecordForm goals={goals} selectedId={selected?.id} onSubmit={addRecord} /> : <RewardForm onSubmit={addReward} />}</Modal> : null}{deleteTarget ? <Modal onClose={() => setDeleteTarget(null)}><DeleteConfirmation goal={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={deleteGoal} /></Modal> : null}
  </div></LanguageContext.Provider>;
}

function UsageTrendChart({ buckets, selectedKey, onSelect, compact = false }: { buckets: UsageBucket[]; selectedKey: string; onSelect: (key: string) => void; compact?: boolean }) {
  const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.milliseconds));
  const width = 1000;
  const height = compact ? 170 : 198;
  const top = 14;
  const bottom = height - 30;
  const left = 28;
  const right = width - 18;
  const points = buckets.map((bucket, index) => {
    const x = buckets.length === 1 ? width / 2 : left + index * (right - left) / (buckets.length - 1);
    const y = bottom - bucket.milliseconds / maxValue * (bottom - top);
    return { bucket, x, y };
  });
  const linePath = points.map((point, index) => (index === 0 ? "M" : "L") + " " + point.x + " " + point.y).join(" ");
  const areaPath = points.length ? linePath + " L " + points[points.length - 1].x + " " + bottom + " L " + points[0].x + " " + bottom + " Z" : "";
  const labelStep = buckets.length > 14 ? Math.ceil(buckets.length / 8) : 1;
  return <div className={"usage-line-chart-wrap" + (compact ? " compact" : "")}>
    <div className="usage-line-chart">
      <svg viewBox={"0 0 " + width + " " + height} role="img" aria-label={compact ? "应用每日使用趋势" : "活动每日使用趋势"} preserveAspectRatio="none">
        <line className="usage-chart-gridline" x1={left} x2={right} y1={top} y2={top} />
        <line className="usage-chart-gridline" x1={left} x2={right} y1={(top + bottom) / 2} y2={(top + bottom) / 2} />
        <line className="usage-chart-gridline" x1={left} x2={right} y1={bottom} y2={bottom} />
        <path className="usage-chart-area" d={areaPath} />
        <path className="usage-chart-line" d={linePath} />
        {points.map((point) => <circle className={point.bucket.key === selectedKey ? "selected" : ""} key={point.bucket.key} cx={point.x} cy={point.y} r={point.bucket.key === selectedKey ? 5 : 3.5} tabIndex={0} role="button" aria-label={point.bucket.label + " " + formatUsageDuration(point.bucket.milliseconds)} onClick={() => onSelect(point.bucket.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point.bucket.key); } }}><title>{point.bucket.label + " · " + formatUsageDuration(point.bucket.milliseconds)}</title></circle>)}
      </svg>
    </div>
    <div className="usage-axis-labels" style={{ "--usage-columns": Math.max(buckets.length, 1) } as CSSProperties}>{buckets.map((bucket, index) => <span key={bucket.key}>{index % labelStep === 0 || index === buckets.length - 1 ? bucket.label : ""}</span>)}</div>
  </div>;
}

function UsageBucketDetails({ buckets, selectedKey, onSelect, compact = false }: { buckets: UsageBucket[]; selectedKey: string; onSelect: (key: string) => void; compact?: boolean }) {
  const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.milliseconds));
  return <div className={"usage-detail-list" + (compact ? " compact" : "")}>{buckets.map((bucket) => <button type="button" className={"usage-detail-row" + (bucket.key === selectedKey ? " selected" : "")} key={bucket.key} onClick={() => onSelect(bucket.key)}><span>{bucket.label}</span><i><em style={{ width: bucket.milliseconds ? Math.max(4, bucket.milliseconds / maxValue * 100) + "%" : "0%" }} /></i><strong>{formatUsageDuration(bucket.milliseconds)}</strong></button>)}</div>;
}

function SoftwareUsage({ sessions, syncing, appCategories, manualLearningDrops, onCategoryChange, lastSyncedAt }: { sessions: Session[]; syncing: boolean; appCategories: AppCategories; manualLearningDrops: number; onCategoryChange: (appKey: string, category: AppCategory) => void; lastSyncedAt: number | null }) {
  const language = useLanguage();
  const [rangeKey, setRangeKey] = useState<UsageRangeKey>("recent7");
  const [displayMode, setDisplayMode] = useState<UsageDisplayMode>("daily");
  const [customFrom, setCustomFrom] = useState(() => dateText(addLocalDay(localDayStart(Date.now()), -6)));
  const [customTo, setCustomTo] = useState(today());
  const [selectedAppKey, setSelectedAppKey] = useState("");
  const [selectedBucketKey, setSelectedBucketKey] = useState("");
  const usage = useMemo(() => softwareUsage(sessions, rangeKey, customFrom, customTo, appCategories), [sessions, rangeKey, customFrom, customTo, appCategories]);
  const categoryDrops = useMemo(() => categoryWaterDrops(sessions, appCategories), [sessions, appCategories]);
  const selectedApp = usage.apps.find((app) => app.key === selectedAppKey) ?? usage.apps[0] ?? null;
  const activeBucketKey = usage.buckets.some((bucket) => bucket.key === selectedBucketKey) ? selectedBucketKey : usage.buckets.at(-1)?.key ?? "";
  const selectedBucket = usage.buckets.find((bucket) => bucket.key === activeBucketKey) ?? null;
  const appTrendBuckets = selectedApp ? usage.buckets.map((bucket, index) => ({ ...bucket, milliseconds: selectedApp.trend[index] ?? 0 })) : [];
  const maxHeat = Math.max(1, ...usage.heatmap.map((bucket) => bucket.milliseconds));
  const syncLabel = syncing ? "正在同步" : lastSyncedAt ? "最近同步 " + new Date(lastSyncedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "等待同步";
  const rangeOptions: { key: UsageRangeKey; label: string }[] = [
    { key: "today", label: "今天" }, { key: "recent7", label: "近 7 天" }, { key: "recent30", label: "近 30 天" }, { key: "recentYear", label: "近一年" }, { key: "all", label: "全部" },
  ];
  const firstHeatmapDay = usage.heatmap[0] ? new Date(usage.heatmap[0].from).getDay() : 1;
  const leadingCells = firstHeatmapDay === 0 ? 6 : firstHeatmapDay - 1;
  const heatmapCells: (UsageBucket | null)[] = [...new Array(leadingCells).fill(null), ...usage.heatmap];
  const dateRangeLabel = usage.range.key === "all" && !sessions.length ? "还没有可用的会话" : new Date(usage.range.from).toLocaleDateString("zh-CN") + " - " + new Date(usage.range.to - 1).toLocaleDateString("zh-CN");
  const trendStyle = { "--usage-columns": Math.max(usage.buckets.length, 1) } as CSSProperties;
  return <section className="software-usage" aria-label="软件使用时长">
    <div className="usage-heading"><div><span className="section-label">软件使用</span><h2>软件使用时长</h2><p>读取 Patina 的有效前台活动，统计与目标成长互不混合。</p></div><span className={"sync-chip" + (syncing ? " syncing" : "")}><i />{syncLabel}</span></div>
    <div className="usage-range-control"><div className="usage-control-row"><div className="usage-range-tabs" role="tablist" aria-label="统计范围">{rangeOptions.map((option) => <button className={rangeKey === option.key ? "active" : ""} key={option.key} onClick={() => setRangeKey(option.key)} role="tab" aria-selected={rangeKey === option.key}>{option.label}</button>)}<button className={rangeKey === "custom" ? "active" : ""} onClick={() => setRangeKey("custom")} role="tab" aria-selected={rangeKey === "custom"}>自定义</button></div><div className="usage-display-tabs" role="tablist" aria-label="显示方式"><span>显示</span><button className={displayMode === "daily" ? "active" : ""} onClick={() => setDisplayMode("daily")} role="tab" aria-selected={displayMode === "daily"}>每日</button><button className={displayMode === "total" ? "active" : ""} onClick={() => setDisplayMode("total")} role="tab" aria-selected={displayMode === "total"}>总和</button></div></div>{rangeKey === "custom" ? <div className="usage-custom-range"><label>开始日期<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><span>至</span><label>结束日期<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label></div> : null}</div>
    <div className="usage-range-caption"><strong>{usage.range.label}</strong><span>{dateRangeLabel}</span></div>
    <div className="usage-metrics"><div><span>范围总时长</span><strong>{formatUsageDuration(usage.totalMilliseconds)}</strong></div><div><span>{usage.range.mode === "month" ? "月均时长" : "日均时长"}</span><strong>{formatUsageDuration(usage.averageMilliseconds)}</strong></div><div><span>活跃天数</span><strong>{usage.activeDays}<small> 天</small></strong></div></div><div className="usage-category-summary"><Droplets size={16} /><span>水滴来源</span><b className="positive">学习软件 {formatSignedPoints(categoryDrops.learningDrops)}</b><b className="positive">手动记录 +{formatPoints(manualLearningDrops)}</b><b className="negative">游戏软件 {categoryDrops.gameDrops ? "-" + formatPoints(categoryDrops.gameDrops) : "0.0"}</b><small>每满 1 小时计算，不计入的软件不影响余额。</small></div>
    {displayMode === "daily" ? <div className="usage-section-block usage-trend-block"><div className="usage-section-title"><div><span className="section-label">每日明细</span><h3>活动趋势</h3></div><span>{usage.range.mode === "month" ? "按月" : "按日"}</span></div>{usage.buckets.length ? <><UsageTrendChart buckets={usage.buckets} selectedKey={activeBucketKey} onSelect={setSelectedBucketKey} /><div className="usage-selected-bucket">{selectedBucket ? <><span>{selectedBucket.label}</span><strong>{formatUsageDuration(selectedBucket.milliseconds)}</strong><small>当前范围内的软件使用时长</small></> : <span>当前范围没有软件使用记录</span>}</div><UsageBucketDetails buckets={usage.buckets} selectedKey={activeBucketKey} onSelect={setSelectedBucketKey} /></> : <UsageEmpty text="当前范围没有软件使用记录" />}</div> : <div className="usage-section-block usage-total-view"><div className="usage-section-title"><div><span className="section-label">总和</span><h3>当前范围总和</h3></div><span>{dateRangeLabel}</span></div><div className="usage-total-highlight"><span>软件使用总时长</span><strong>{formatUsageDuration(usage.totalMilliseconds)}</strong><small>汇总全部已读取的有效前台活动，不按单条会话重复累计。</small></div><div className="usage-total-breakdown">{usage.apps.slice(0, 6).map((app) => <div key={app.key}><span>{app.name}</span><strong>{formatUsageDuration(app.milliseconds)}</strong><small>{app.activeDays} 天有记录 · {app.percentage}%</small></div>)}</div></div>}
    <div className="usage-insight-grid"><div className="usage-section-block usage-app-ranking"><div className="usage-section-title"><div><span className="section-label">应用</span><h3>应用使用排行</h3></div><Monitor size={17} /></div>{usage.apps.length ? <div className="usage-app-list">{usage.apps.map((app, index) => <div className={"usage-app-row" + (selectedApp?.key === app.key ? " selected" : "")} key={app.key}><button className="usage-app-main" onClick={() => setSelectedAppKey(app.key)}><b className="usage-app-rank">{index + 1}</b><span className="usage-app-name"><strong>{app.name}</strong><small>{app.activeDays} 天有记录</small><i><em style={{ width: Math.min(100, app.percentage) + "%" }} /></i></span><span className="usage-app-value"><strong>{formatUsageDuration(app.milliseconds)}</strong><small>{app.percentage}%</small>{app.waterDrops !== 0 ? <em className={app.waterDrops > 0 ? "positive" : "negative"}>{app.waterDrops > 0 ? "+" : ""}{formatPoints(app.waterDrops)} 水滴</em> : null}</span></button><select className="usage-app-category" aria-label={app.name + " 分类"} value={app.category} onChange={(event) => onCategoryChange(app.key, event.target.value as AppCategory)}><option value="neutral">不计入</option><option value="learning">学习软件，加水滴</option><option value="game">游戏软件，扣水滴</option></select></div>)}</div> : <UsageEmpty text="当前范围没有应用记录" />}</div><div className="usage-section-block usage-app-trend"><div className="usage-section-title"><div><span className="section-label">应用趋势</span><h3>{selectedApp?.name ?? "选择一个应用"}</h3></div><TrendingUp size={17} /></div>{selectedApp ? <><div className="usage-app-trend-metrics"><div><span>当前范围总和</span><strong>{formatUsageDuration(selectedApp.milliseconds)}</strong></div><div><span>活跃天数</span><strong>{selectedApp.activeDays}<small> 天</small></strong></div></div><UsageTrendChart buckets={appTrendBuckets} compact selectedKey={activeBucketKey} onSelect={setSelectedBucketKey} /><UsageBucketDetails buckets={appTrendBuckets} compact selectedKey={activeBucketKey} onSelect={setSelectedBucketKey} /></> : <UsageEmpty text="选择应用后查看它在当前范围的变化" />}</div></div>
    <div className="usage-section-block usage-heatmap"><div className="usage-section-title"><div><span className="section-label">活动热力图</span><h3>每天的使用强度</h3></div><span>{usage.heatmap.length > 31 ? "最近 365 天" : usage.range.label}</span></div>{usage.heatmap.length ? <><div className="heatmap-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div className="heatmap-grid">{heatmapCells.map((bucket, index) => bucket ? <div className="heatmap-cell" data-level={bucket.milliseconds ? Math.min(4, Math.ceil(bucket.milliseconds / maxHeat * 4)) : 0} key={bucket.key} title={bucket.label + " · " + formatUsageDuration(bucket.milliseconds)} /> : <div className="heatmap-cell blank" key={"blank-" + index} />)}</div><div className="heatmap-legend"><span>少</span><i data-level="0" /><i data-level="1" /><i data-level="2" /><i data-level="3" /><i data-level="4" /><span>多</span></div></> : <UsageEmpty text="当前范围没有活动" />}</div>
    <div className="usage-section-block usage-sessions"><div className="usage-section-title"><div><span className="section-label">会话明细</span><h3>最近使用记录</h3></div><span>最近 {usage.recentSessions.length} 条</span></div>{usage.recentSessions.length ? <div className="records-table"><div className="records-row records-head"><span>应用</span><span>开始时间</span><span>结束时间</span><span>时长</span></div>{usage.recentSessions.map((session) => <div className="records-row" key={session.id}><strong title={session.exeName}>{session.appName || session.exeName}</strong><span>{sessionTime(session.startTime, language)}</span><span>{session.endTime ? sessionTime(session.endTime, language) : "进行中"}</span><span>{formatUsageDuration(sessionDuration(session) * 60000)}</span></div>)}</div> : <UsageEmpty text="当前范围没有会话记录" />}</div>
  </section>;
}
function UsageEmpty({ text: message }: { text: string }) { return <div className="usage-empty"><BarChart3 size={19} /><span>{message}</span></div>; }

function GoalCard({ goal, stat, selected, onClick }: { goal: Goal; stat: ReturnType<typeof goalStats>; selected: boolean; onClick: () => void }) { const language = useLanguage(); const percent = goal.weekly ? Math.min(100, stat.week / goal.weekly * 100) : 0; return <button className={`plant-card ${selected ? "selected" : ""}`} onClick={onClick}><div className="card-plant"><Plant kind={plantKindFor(goal)} units={stat.units} progress={plantProgress(stat.total)} /></div><div className="card-info"><div className="card-title"><strong>{goal.title}</strong><span>{stage(stat.units, false, language)}</span></div><p>{goal.app || text(language, "手动记录", "Manual log")}</p><div className="progress"><i style={{ width: `${percent}%` }} /></div><div className="card-meta"><span>{text(language, "本周", "This week")} {minutes(stat.week, language)}</span><span>{stat.units} {text(language, "成长单位", "units")}</span></div></div></button>; }
function EmptyState({ onClick }: { onClick: () => void }) { const language = useLanguage(); return <div className="empty-state"><div><Sprout size={24} /></div><strong>{text(language, "还没有进行中的目标", "Your greenhouse is empty")}</strong><span>{text(language, "创建一个目标，开始记录第一步。", "Create a goal and leave your first leaf.")}</span><button className="secondary" onClick={onClick}><Plus size={15} /> {text(language, "创建目标", "Create goal")}</button></div>; }
  function Detail({ goal, stat, onRecord, onPause, onComplete, onDelete }: { goal: Goal; stat: ReturnType<typeof goalStats>; onRecord: () => void; onPause: () => void; onComplete: () => void; onDelete: () => void }) { const language = useLanguage(); const todayPercent = goal.daily ? Math.min(100, stat.today / goal.daily * 100) : 0; return <section className="detail-panel"><div className="detail-copy"><span className="section-label">{text(language, "当前目标", "CURRENT CARE")}</span><h2>{goal.title}</h2><p>{goal.description || text(language, "每天学习一点，目标会慢慢长大。", "A little care each day helps the goal grow.")}</p><div className="detail-plant"><Plant kind={plantKindFor(goal)} units={stat.units} progress={plantProgress(stat.total)} /><div><strong>{stage(stat.units, false, language)}</strong><span>{stat.units < 30 ? text(language, `还需 ${30 - stat.units} 个成长单位进入下一阶段`, `${30 - stat.units} more growth units to reach the next stage`) : text(language, "可以完成这个目标了", "This plant is ready to flower")}</span></div></div></div><div className="detail-right"><div className="metric"><span>{text(language, "今日时长", "Today")}</span><strong>{minutes(stat.today, language)}</strong><div className="metric-bar"><i style={{ width: `${todayPercent}%` }} /></div><small>{text(language, "今日建议", "Target")} {minutes(goal.daily, language)}</small></div><div className="metric"><span>{text(language, "本周时长", "This week")}</span><strong>{minutes(stat.week, language)}</strong><small>{text(language, "每周目标", "Target")} {minutes(goal.weekly, language)}</small></div><div className="metric"><span>{text(language, "成长单位", "Growth units")}</span><strong>{stat.units}</strong><small>{text(language, "每 25 分钟 +1", "+1 every 25 minutes")}</small></div><div className="detail-buttons"><button className="secondary" onClick={onRecord}><Clock3 size={15} /> {text(language, "记录学习", "Log learning")}</button>{stat.units >= 30 ? <button className="primary" onClick={onComplete}><Flower2 size={15} /> {text(language, "完成目标", "Move to the growth greenhouse")}</button> : <button className="quiet-icon" onClick={onPause} title={goal.status === "paused" ? text(language, "恢复目标", "Resume goal") : text(language, "暂停目标", "Pause goal")}>{goal.status === "paused" ? <RefreshCw size={16} /> : <Target size={16} />}</button>}<button className="danger-button" onClick={onDelete} title={text(language, "删除目标", "Delete goal")}><Trash2 size={15} /> {text(language, "删除目标", "Delete goal")}</button></div></div></section>; }
 function Garden({ completed, onOpen }: { completed: Goal[]; onOpen: () => void }) { const language = useLanguage(); return <button className="panel garden garden-trigger" onClick={onOpen}><div className="panel-heading"><div><span className="section-label">{text(language, "成长温室", "GROWTH GREENHOUSE")}</span><h2>{text(language, "已完成目标", "Completed goals")}</h2></div><Trees size={19} /></div>{completed.length ? <div className="garden-row">{completed.slice(0, 4).map((goal) => <div key={goal.id}><Plant kind={plantKindFor(goal)} units={30} completed small /><span>{goal.title}</span></div>)}</div> : <div className="garden-empty"><div className="fence" /><span>{text(language, "完成的目标会保存在这里。", "Finish a plant and it will come here.")}</span></div>}<span className="garden-cta">{text(language, "查看成长温室", "Open growth greenhouse")} <ChevronRight size={14} /></span></button>; }
 function CompletedGarden({ completed, selectedId, onSelect, onBack, stats, onDelete }: { completed: Goal[]; selectedId: string | null; onSelect: (id: string) => void; onBack: () => void; stats: Map<string, ReturnType<typeof goalStats>>; onDelete: (goal: Goal) => void }) { const language = useLanguage(); const selected = completed.find((goal) => goal.id === selectedId) ?? null; return <div className="page-stack garden-page"><div className="page-intro garden-page-intro"><button className="back-button" onClick={onBack}><ChevronLeft size={15} /> {text(language, "返回我的温室", "Back to greenhouse")}</button><span className="section-label">{text(language, "成长温室", "GROWTH GREENHOUSE")}</span><h2>{text(language, "完成过的目标，都在这里", "Every plant marks something you finished")}</h2><p>{completed.length ? text(language, `这里保存了 ${completed.length} 个完成目标。点击植物查看完成日期和目标详情。`, `${completed.length} completed goal${completed.length === 1 ? "" : "s"} live here. Select a plant to review its time.`) : text(language, "完成的目标会从我的温室移到这里。", "Completed goals move here from the greenhouse.")}</p></div><section className="garden-scene"><div className="scene-roof" /><div className="scene-sun" /><div className="scene-spark spark-one" /><div className="scene-spark spark-two" /><div className="garden-bench" /><div className={`completed-plant-grid ${completed.length > 4 ? "has-back-row" : ""}`}>{completed.length ? completed.map((goal) => <button className={`garden-plant ${selected?.id === goal.id ? "selected" : ""}`} key={goal.id} onClick={() => onSelect(goal.id)}><Plant kind={plantKindFor(goal)} units={30} completed /><strong>{goal.title}</strong><span>{dateLabel(goal.completedAt, language)}</span></button>) : <div className="garden-scene-empty"><Trees size={28} /><strong>{text(language, "这里还没有完成的植物", "No completed plants yet")}</strong><span>{text(language, "先回到温室，完成一个目标。", "Return to the greenhouse and care for a goal.")}</span><button className="secondary" onClick={onBack}><ChevronLeft size={15} /> {text(language, "返回我的温室", "Back to growing")}</button></div>}</div></section>{selected ? <section className="panel garden-detail"><div><span className="section-label">{text(language, "目标记录", "PLANT RECORD")}</span><h2>{selected.title}</h2><p>{selected.description || text(language, "这个目标没有填写描述。", "No additional description was recorded.")}</p><dl><div><dt>{text(language, "完成日期", "Completed")}</dt><dd>{dateLabel(selected.completedAt, language)}</dd></div><div><dt>{text(language, "开始日期", "Started")}</dt><dd>{dateLabel(selected.startDate, language)}</dd></div><div><dt>{text(language, "计划目标", "Weekly target")}</dt><dd>{text(language, "每周", "Per week")} {minutes(selected.weekly, language)}</dd></div><div><dt>{text(language, "学习软件", "Learning app")}</dt><dd>{selected.app || text(language, "手动记录", "Manual log")}</dd></div><div><dt>{text(language, "累计成长", "Growth")}</dt><dd>{stats.get(selected.id)?.units ?? 0} {text(language, "个成长单位", "units")}</dd></div></dl><button className="danger-button" onClick={() => onDelete(selected)}><Trash2 size={15} /> {text(language, "删除已完成目标", "Delete completed goal")}</button></div><div className="garden-detail-plant"><Plant kind={plantKindFor(selected)} units={30} completed /></div></section> : null}</div>; }
 function MiniRewards({ rewards, points, onOpen }: { rewards: Reward[]; points: number; onOpen: () => void }) { const language = useLanguage(); return <section className="panel mini-rewards"><div className="panel-heading"><div><span className="section-label">{text(language, "奖励", "REWARD SHELF")}</span><h2>{text(language, "奖励", "Reward shelf")}</h2></div><button className="text-button" onClick={onOpen}>{text(language, "查看全部", "View all")} <ChevronRight size={15} /></button></div>{rewards.slice(0, 2).map((reward) => <div className="mini-reward" key={reward.id}><Gift size={17} /><div><strong>{reward.name}</strong><span>{reward.annual ? text(language, "年度奖励", "Annual reward") : text(language, "可兑换奖励", "Something to look forward to")}</span></div><b>{reward.redeemed ? text(language, "已兑换", "Redeemed") : `${formatPoints(reward.cost)} 水滴`}</b></div>)}<div className="mini-points"><Droplets size={16} /> 可用 <strong>{formatPoints(points)} 水滴</strong></div></section>; }
 function Rewards({ rewards, points, onAdd, onRedeem }: { rewards: Reward[]; points: number; onAdd: () => void; onRedeem: (id: string) => void }) { const language = useLanguage(); return <div className="page-stack"><div className="page-intro"><span className="section-label">{text(language, "奖励", "REWARD SHELF")}</span><h2>{text(language, "兑换奖励", "Redeem rewards")}</h2><p>用学习获得的水滴，兑换你设定的奖励。</p><div className="big-points"><Droplets size={22} /><strong>{formatPoints(points)}</strong><span>可用水滴</span></div><button className="primary" onClick={onAdd}><Plus size={16} /> {text(language, "添加奖励", "Add reward")}</button></div><section className="panel reward-list">{rewards.map((reward) => <div className="reward-row" key={reward.id}><div className="reward-icon"><Gift size={20} /></div><div><strong>{reward.name}</strong><span>{reward.annual ? text(language, "年度奖励", "Annual reward") : text(language, "普通奖励", "A small reward")}</span></div><button className="secondary" disabled={reward.redeemed || points < reward.cost} onClick={() => onRedeem(reward.id)}>{reward.redeemed ? <><Check size={14} /> {text(language, "已兑换", "Redeemed")}</> : `${formatPoints(reward.cost)} 水滴兑换`}</button></div>)}</section></div>; }
 type SettingsProps = { path: string; source: Source | null; sessions: Session[]; syncing: boolean; appCategories: AppCategories; manualLearningDrops: number; onCategoryChange: (appKey: string, category: AppCategory) => void; lastSyncedAt: number | null; onSave: (path: string) => void; onFileSelect: (file: File) => Promise<void> };
  function Settings({ path, source, sessions, syncing, appCategories, manualLearningDrops, onCategoryChange, lastSyncedAt, onSave, onFileSelect }: SettingsProps) {
   const language = useLanguage();
    const title = source?.installed ? (source.available ? text(language, "Patina 已连接", "Patina connected") : text(language, "Patina 已安装，等待数据库", "Patina installed; database not found")) : text(language, "需要安装 Patina", "Patina installation required");
    const detail = source?.installed ? text(language, `${source.available ? "正在读取活动记录" : "未找到 Patina 数据库"} · 最近同步 ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "等待中"}`, `${source.available ? "Reading automatically" : "Patina database not found"} · Last sync ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "waiting"}`) : text(language, "成长温室必须依赖 Patina，当前不会独立读取软件使用时间", "Growth Greenhouse requires Patina and does not read software usage independently");
    return <div className="settings-wrapper"><div className="settings-sync-strip" role="status"><i className={source?.available && source.installed ? "online" : ""} /><div><strong>{title}</strong><span>{detail}</span></div></div>{source && !source.installed ? <PatinaDependencyNotice /> : null}<SettingsContent path={path} source={source} sessions={sessions} syncing={syncing} appCategories={appCategories} manualLearningDrops={manualLearningDrops} onCategoryChange={onCategoryChange} lastSyncedAt={lastSyncedAt} onSave={onSave} onFileSelect={onFileSelect} /></div>;
  }
  function PatinaDependencyNotice() {
    return <section className="patina-dependency" role="alert"><div className="patina-dependency-icon"><Monitor size={18} /></div><div><strong>需要先安装 Patina</strong><p>成长温室依赖 Patina 记录软件前台使用时间，不会独立读取或推测软件使用时长。</p><p>请在 Patina 的 GitHub Releases 页面下载 Windows 安装包中的 <code>*_x64-setup.exe</code> 文件，不要下载 Source code ZIP。</p><a href={PATINA_RELEASES_URL} target="_blank" rel="noreferrer">打开 Patina GitHub Releases <ChevronRight size={14} /></a></div></section>;
  }
 function SettingsContent({ path, source, sessions, syncing, appCategories, manualLearningDrops, onCategoryChange, lastSyncedAt, onSave, onFileSelect }: SettingsProps) {
   const language = useLanguage();
   const [value, setValue] = useState(path);
   useEffect(() => setValue(path), [path]);
   return <div className="page-stack settings-page"><div className="page-intro"><span className="section-label">数据源</span><h2>连接 Patina</h2><p>只读读取 Patina 的前台活动记录，用于计算目标进度。</p></div><SoftwareUsage sessions={sessions} syncing={syncing} appCategories={appCategories} manualLearningDrops={manualLearningDrops} onCategoryChange={onCategoryChange} lastSyncedAt={lastSyncedAt} /><section className="panel settings-panel"><div className="path-hints"><div><span>程序路径</span><code>%LOCALAPPDATA%\Patina\Patina.exe</code></div><div><span>数据库路径</span><code>%APPDATA%\Patina\patina.db</code></div></div><label>数据库路径<span>留空则使用默认路径：%APPDATA%\Patina\patina.db</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder="留空使用默认路径" /></label><div className="settings-actions"><button className="primary" onClick={() => onSave(value)}><Check size={15} /> 保存路径</button><label className="file-picker secondary"><FolderOpen size={15} /> 选择数据库<input type="file" accept=".db,.sqlite,.sqlite3" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFileSelect(file); event.currentTarget.value = ""; }} /></label></div>{source?.databasePath ? <code className="selected-path">当前读取：{source.databasePath}</code> : null}</section></div>;
 }
function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) { const language = useLanguage(); return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal"><button className="modal-close" onClick={onClose} aria-label={text(language, "关闭", "Close")}><X size={18} /></button>{children}</div></div>; }
function DeleteConfirmation({ goal, onCancel, onConfirm }: { goal: Goal; onCancel: () => void; onConfirm: () => void }) { const language = useLanguage(); const completed = goal.status === "completed"; return <div className="form delete-confirmation"><span className="section-label">{completed ? text(language, "删除完成目标", "DELETE COMPLETED GOAL") : text(language, "删除进行中目标", "DELETE ACTIVE GOAL")}</span><h2>确认删除“{goal.title}”？</h2><p>{completed ? "删除后，这个目标会从成长温室中移除。" : "删除后，这个目标会从进行中的目标中移除。"}</p><div className="delete-warning"><Trash2 size={17} /><div><strong>此操作无法恢复</strong><span>目标及其关联的手动学习记录都会被删除。</span><span>不会修改 Patina 的原始数据库。</span></div></div><div className="delete-actions"><button className="secondary" onClick={onCancel}>取消</button><button className="danger-button" onClick={onConfirm}><Trash2 size={15} /> 确认删除</button></div></div>; }
function GoalForm({ sessions, goals, onSubmit }: { sessions: Session[]; goals: Goal[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const language = useLanguage(); const apps = Array.from(new Map(sessions.map((session) => [session.exeName.toLowerCase(), { exe: session.exeName, app: session.appName || session.exeName }])).values()).filter((item) => !goals.some((goal) => goal.exe.toLowerCase() === item.exe.toLowerCase() && goal.status !== "completed")); return <form className="form" onSubmit={onSubmit}><span className="section-label">{text(language, "新目标", "NEW PLANT")}</span><h2>{text(language, "创建学习目标", "Plant a goal")}</h2><p>{text(language, "先写下想学的事，计划可以之后再补充。", "Keep it simple. Start with what you genuinely want to learn.")}</p><label>{text(language, "目标名称", "Goal name")}<input name="title" required autoFocus placeholder={text(language, "例如：Blender 建模", "e.g. Learn Blender modeling")} /></label><label>{text(language, "每周学习时长（分钟）", "Weekly target (minutes)")}<input name="weekly" type="number" step="any" inputMode="numeric" defaultValue="200" /></label><details className="advanced-options"><summary>{text(language, "更多设置", "More settings")}</summary><label>{text(language, "目标描述", "Short description")}<input name="description" placeholder={text(language, "例如：完成一个可以打印的模型", "e.g. Make a first printable model")} /></label><label>{text(language, "每日建议时长（分钟）", "Daily suggestion (minutes)")}<input name="daily" type="number" step="any" inputMode="numeric" defaultValue="25" /></label><label>{text(language, "开始日期", "Start date")}<input name="startDate" type="date" defaultValue={today()} /></label><label>{text(language, "关联 Patina 软件", "Learning app")}<span className="hint">{text(language, "可选。关联后自动累计该软件的前台活动时长。", "Optional. Effective time from Patina will be counted automatically.")}</span><select name="exe" defaultValue="" onChange={(event) => { const option = event.currentTarget.selectedOptions[0]; const input = event.currentTarget.form?.elements.namedItem("app") as HTMLInputElement | null; if (input) input.value = option?.dataset.app ?? ""; }}><option value="" data-app="">{text(language, "暂不关联，使用手动记录", "No app yet; use manual logs")}</option>{apps.map((app) => <option key={app.exe} value={app.exe} data-app={app.app}>{app.app}</option>)}</select><input type="hidden" name="app" /></label></details><button className="primary form-submit"><Sprout size={16} /> {text(language, "创建目标", "Plant goal")}</button></form>; }
function RecordForm({ goals, selectedId, onSubmit }: { goals: Goal[]; selectedId?: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const language = useLanguage(); const selectedGoal = goals.find((goal) => goal.id === selectedId); return <form className="form" onSubmit={onSubmit}><span className="section-label">{text(language, "学习记录", "MANUAL SESSION")}</span><h2>{text(language, "记录学习", "Log learning")}</h2><p>{text(language, "记下这次学习，植物会继续成长。", "Learning also happens away from the computer. Keep a record of it here.")}</p>{selectedGoal ? <><div className="selected-goal"><span>{text(language, "当前目标", "Learning goal")}</span><strong>{selectedGoal.title}</strong></div><input type="hidden" name="goalId" value={selectedGoal.id} /></> : <label>{text(language, "学习目标", "Learning goal")}<select name="goalId" defaultValue={goals[0]?.id} required>{goals.filter((goal) => goal.status !== "completed").map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>}<label>{text(language, "学习时长（分钟）", "Learning time (minutes)")}<input name="minutes" type="number" step="any" inputMode="numeric" defaultValue="25" autoFocus /></label><details className="advanced-options"><summary>{text(language, "修改日期", "Change date")}</summary><label>{text(language, "学习日期", "Date")}<input name="date" type="date" defaultValue={today()} /></label></details><button className="primary form-submit"><Check size={16} /> {text(language, "保存记录", "Save learning")}</button></form>; }
  function RewardForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { const language = useLanguage(); return <form className="form" onSubmit={onSubmit}><span className="section-label">{text(language, "新奖励", "NEW REWARD")}</span><h2>{text(language, "添加奖励", "Add a reward")}</h2><p>{text(language, "设置一个想兑换的奖励。", "Give your progress somewhere to go.")}</p><label>{text(language, "奖励名称", "Reward name")}<input name="name" required autoFocus placeholder={text(language, "例如：买一套新的模型素材", "e.g. Buy a new model pack")} /></label><label>需要水滴<input name="cost" type="number" step="any" inputMode="numeric" defaultValue="10" /></label><label className="check-label"><input name="annual" type="checkbox" /> {text(language, "这是年度奖励", "This is an annual reward")}</label><button className="primary form-submit"><Gift size={16} /> {text(language, "添加奖励", "Add to shelf")}</button></form>; }
