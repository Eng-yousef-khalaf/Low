import { useState, useEffect } from 'react';
import { useGetDashboardStats, useGetCurrentUser, useListSessions, type Session } from '@workspace/api-client-react';
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Sparkles,
  FileKey,
  Gavel,
  XCircle,
  CheckSquare,
  Timer,
  AlertTriangle,
  ListChecks,
  AlertCircle,
  Scale,
  User,
  ChevronLeft,
  ShieldCheck,
  Database,
  Zap,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'wouter';
import { TimeRemainingBadge } from '@/components/time-remaining';
import { getArabicDayName } from '@/lib/hijri';
import { formatFriendlySubscriptionDate } from '@/lib/date-validation';
import { readUserScopedJson } from '@/lib/user-storage';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Check, X } from 'lucide-react';

const stats = [
  {
    key: 'totalCases',
    label: 'إجمالي القضايا',
    icon: Briefcase,
    gradient: 'from-emerald-600/15 to-emerald-700/5',
    iconBg: 'bg-emerald-600/15',
    iconColor: 'text-emerald-700 dark:text-emerald-400',
    borderColor: 'border-emerald-600/20',
    dotColor: 'bg-emerald-600',
    href: '/sessions',
  },
  {
    key: 'todayHearings',
    label: 'جلسات اليوم',
    icon: Calendar,
    gradient: 'from-amber-500/15 to-amber-600/5',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-500',
    borderColor: 'border-amber-500/20',
    dotColor: 'bg-amber-500',
    href: '/sessions',
  },
  {
    key: 'upcomingHearings',
    label: 'جلسات قادمة',
    icon: Clock,
    gradient: 'from-emerald-500/15 to-emerald-600/5',
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/20',
    dotColor: 'bg-emerald-500',
    href: '/sessions',
  },
  {
    key: 'finishedHearings',
    label: 'جلسات منتهية',
    icon: CheckCircle2,
    gradient: 'from-purple-500/15 to-purple-600/5',
    iconBg: 'bg-purple-500/15',
    iconColor: 'text-purple-500',
    borderColor: 'border-purple-500/20',
    dotColor: 'bg-purple-500',
    href: '/sessions',
  },
  {
    key: 'totalPoas',
    label: 'إجمالي الوكالات',
    icon: FileKey,
    gradient: 'from-blue-500/15 to-blue-600/5',
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-500',
    borderColor: 'border-blue-500/20',
    dotColor: 'bg-blue-500',
    href: '/poa',
  },
  {
    key: 'favorableJudgments',
    label: 'أحكام نهائية',
    icon: Gavel,
    gradient: 'from-emerald-600/15 to-emerald-700/5',
    iconBg: 'bg-emerald-600/20',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    borderColor: 'border-emerald-600/30',
    dotColor: 'bg-emerald-600',
    href: '/judgments',
  },
  {
    key: 'unfavorableJudgments',
    label: 'أحكام ابتدائية',
    icon: XCircle,
    gradient: 'from-blue-600/15 to-blue-700/5',
    iconBg: 'bg-blue-600/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
    borderColor: 'border-blue-600/30',
    dotColor: 'bg-blue-600',
    href: '/judgments',
  },
] as const;

const taskStats = [
  {
    key: 'totalTasks',
    label: 'إجمالي المهام',
    icon: ListChecks,
    gradient: 'from-amber-500/15 to-amber-600/5',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-500',
    borderColor: 'border-amber-500/20',
    dotColor: 'bg-amber-500',
  },
  {
    key: 'inProgressTasks',
    label: 'قيد التنفيذ',
    icon: Timer,
    gradient: 'from-blue-500/15 to-blue-600/5',
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-500',
    borderColor: 'border-blue-500/20',
    dotColor: 'bg-blue-500',
  },
  {
    key: 'completedTasks',
    label: 'مهام مكتملة',
    icon: CheckSquare,
    gradient: 'from-emerald-500/15 to-emerald-600/5',
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/20',
    dotColor: 'bg-emerald-500',
  },
  {
    key: 'urgentTasks',
    label: 'مهام عاجلة',
    icon: AlertTriangle,
    gradient: 'from-red-500/15 to-red-600/5',
    iconBg: 'bg-red-500/15',
    iconColor: 'text-red-500',
    borderColor: 'border-red-500/20',
    dotColor: 'bg-red-500',
  },
] as const;

interface StoredTask {
  id: number;
  title: string;
  assignee: string;
  priority: 'عاجل' | 'عالي' | 'متوسط' | 'منخفض';
  dueDate: string;
  status: 'قيد الانتظار' | 'قيد التنفيذ' | 'مكتملة' | 'ملغاة';
  notes?: string;
}

function deriveEffectiveStatus(storedStatus: string, hearingAt: string | null | undefined): string {
  if (storedStatus === 'Cancelled' || storedStatus === 'Finished') return storedStatus;
  if (!hearingAt) return storedStatus || 'Upcoming';
  const hearingTime = new Date(hearingAt).getTime();
  if (isNaN(hearingTime)) return storedStatus || 'Upcoming';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  if (hearingTime < todayStart) return 'Finished';
  if (hearingTime >= todayStart && hearingTime < todayEnd) return 'Today';
  return 'Upcoming';
}

export default function DashboardPage() {
  const { data, isLoading, error } = useGetDashboardStats();
  const { data: currentUser } = useGetCurrentUser();
  const { data: allSessions = [], isLoading: isLoadingSessions, error: sessionsError, refetch: refetchSessions } = useListSessions();
  const [urgentTasks, setUrgentTasks] = useState<StoredTask[]>([]);

  // Load active urgent tasks from server (with account-scoped local cache fallback)
  useEffect(() => {
    if (!currentUser) {
      setUrgentTasks([]);
      return;
    }
    let cancelled = false;
    fetch('/api/tasks', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('tasks_fetch_failed');
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        const rows: StoredTask[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        const filtered = rows
          .filter((t) => t.status !== 'مكتملة' && t.status !== 'ملغاة')
          .slice(0, 4);
        setUrgentTasks(filtered);
      })
      .catch(() => {
        if (cancelled) return;
        const cached = readUserScopedJson<StoredTask[]>('tasks_confirmed', currentUser as any, []);
        setUrgentTasks(
          cached.filter((t) => t.status !== 'مكتملة' && t.status !== 'ملغاة').slice(0, 4),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Filter today and upcoming sessions, sorted chronologically
  const upcomingSessions = (allSessions || [])
    .filter((s: Session) => {
      const eff = deriveEffectiveStatus(s.status, s.hearingAt);
      return eff === 'Today' || eff === 'Upcoming';
    })
    .sort((a: Session, b: Session) => {
      const tA = a.hearingAt ? new Date(a.hearingAt).getTime() : Infinity;
      const tB = b.hearingAt ? new Date(b.hearingAt).getTime() : Infinity;
      return tA - tB;
    })
    .slice(0, 4);

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-destructive/30 bg-destructive/8 p-5 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-destructive shrink-0" />
          <p className="text-sm text-destructive font-medium">فشل تحميل إحصائيات لوحة التحكم</p>
        </div>
      </div>
    );
  }

  const isAdmin = currentUser?.role === 'admin';
  const isUnlimited = isAdmin || currentUser?.ai_quota_limit === -1 || currentUser?.plan_tier === 'unlimited';
  const aiUsed = currentUser?.ai_usage_count || 0;
  const aiQuota = currentUser?.ai_quota_limit ?? 50;
  const aiPercent = isUnlimited ? 100 : Math.min(100, Math.round((aiUsed / (aiQuota || 1)) * 100));
  const subInfo = formatFriendlySubscriptionDate(currentUser?.subscription_end_date);
  const [showPlansModal, setShowPlansModal] = useState(false);

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Session Data Fetch Failure Alert */}
      {sessionsError && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200 fade-in-up">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="text-xs">
              <p className="font-bold">تعذر الاتصال بمصدر بيانات الجلسات (Google Sheets)</p>
              <p className="text-muted-foreground mt-0.5">
                مؤشرات القضايا والجلسات تظهر كـ «تعذر التحميل» لضمان الدقة وتجنب أي التباس. الأقسام الأخرى (الوكالات، الأحكام، المهام) تعمل بنمط التخزين الآمن دون توقف.
              </p>
            </div>
          </div>
          <button
            onClick={() => refetchSessions()}
            className="text-xs font-bold px-3 py-1.5 rounded-lg border border-amber-500/40 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 cursor-pointer shrink-0 transition-colors"
          >
            إعادة محاولة الربط
          </button>
        </div>
      )}

      {/* Subscription Expiration Reminder Banner */}
      {(subInfo.isExpiringSoon || subInfo.isExpired) && (
        <div className={`rounded-2xl border p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 ${
          subInfo.isExpired
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100'
        }`}>
          <div className="flex items-start sm:items-center gap-3.5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              subInfo.isExpired ? 'bg-destructive/20 text-destructive' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
            }`}>
              <AlertCircle className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold">
                  {subInfo.isExpired ? 'انتهت صلاحية اشتراك الحساب ⛔' : 'تذكير موعد تجديد الاشتراك ⚠️'}
                </h3>
                <span className={`text-[10px] text-white font-bold px-2 py-0.5 rounded-full ${
                  subInfo.isExpired ? 'bg-destructive' : 'bg-amber-500'
                }`}>
                  {subInfo.daysRemaining !== null && subInfo.daysRemaining >= 0
                    ? `متبقي ${subInfo.daysRemaining} أيام`
                    : 'منتهي'}
                </span>
              </div>
              <p className="text-xs mt-1 font-medium leading-relaxed opacity-90">
                {subInfo.text}. يرجى تجديد الاشتراك لضمان استمرار تنبيهات الواتساب واستخراج الجلسات.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowPlansModal(true)}
            className="text-xs font-bold px-4 py-2 rounded-xl bg-amber-600 text-white hover:bg-amber-700 shadow-sm transition-all cursor-pointer shrink-0"
          >
            تجديد / ترقية الباقة
          </button>
        </div>
      )}

      {/* Header with Lawyer Status & Actions */}
      <div className="fade-in-up flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-2 h-6 rounded-full bg-primary" />
            <h1 className="text-2xl font-black tracking-tight text-foreground">
              مرحباً بك، سيادة المحامي ⚖️
            </h1>
          </div>
          <p className="text-muted-foreground text-sm mr-4">
            المكتب الرقمي الموحد لإدارة جلسات المحاكم، الوكالات، الأحكام القضائية، والمهام اليومية
          </p>
        </div>
        <div className="flex items-center gap-2.5 mr-4 md:mr-0 flex-wrap">
          <button
            onClick={() => setShowPlansModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl font-bold text-xs border border-border bg-card hover:bg-accent cursor-pointer transition-all"
          >
            <span>مقارنة الباقات والترقية</span>
          </button>
          <Link href="/chat">
            <div
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white shadow-md cursor-pointer transition-all duration-200 hover:shadow-lg hover:brightness-105"
              style={{ background: 'linear-gradient(135deg, #B88A3B 0%, #8E6825 100%)' }}
            >
              <Sparkles className="w-4 h-4" />
              <span>تحليل رسالة جلسة جديدة</span>
            </div>
          </Link>
        </div>
      </div>

      {/* Lawyer Account & AI Quota Indicator Card */}
      {currentUser && (
        <div className="fade-in-up rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            {/* Account Info */}
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-xs" style={{ background: 'linear-gradient(135deg, #093A2A 0%, #0D4E3A 100%)' }}>
                <Scale className="w-5 h-5 text-amber-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-foreground truncate">{currentUser.username}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                    {isUnlimited ? 'باقة مفتوحة (مشرف)' : currentUser.plan_tier === 'pro' ? 'باقة برو (Pro)' : 'باقة بلس (Plus)'}
                  </span>
                </div>
                <p className="text-[11px] mt-1 flex items-center gap-1.5" data-testid="dashboard-connection-status">
                  <Database className={`w-3.5 h-3.5 shrink-0 ${
                    sessionsError || (currentUser as any).googleLinkStatus === 'incomplete' || (currentUser as any).googleLinkStatus === 'unlinked'
                      ? 'text-amber-500'
                      : (currentUser as any).googleLinkStatus === 'connected'
                        ? 'text-emerald-500'
                        : 'text-sky-500'
                  }`} />
                  <span className="text-muted-foreground font-medium">
                    {sessionsError
                      ? 'تعذر الاتصال بمصدر الجلسات حالياً'
                      : (currentUser as any).googleLinkStatus === 'connected'
                        ? 'مزامنة Google Sheets (متصلة)'
                        : (currentUser as any).googleLinkStatus === 'incomplete' || (currentUser as any).googleLinkStatus === 'unlinked'
                          ? 'ربط جدول المكتب غير مكتمل'
                          : 'تخزين المكتب المعزول (نشط)'}
                  </span>
                </p>
              </div>
            </div>

            {/* AI SMS Quota Progress & Transparency */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground font-semibold flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  رصيد استخراج الرسائل بالذكاء الاصطناعي
                </span>
                <span className="font-mono font-bold text-foreground">
                  {isUnlimited ? 'مفتوح (غير محدود)' : `${aiUsed} / ${aiQuota}`}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${aiPercent}%`,
                    background: isUnlimited
                      ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                      : aiPercent >= 100 ? '#ef4444' : aiPercent >= 80 ? '#f59e0b' : '#B88A3B',
                  }}
                />
              </div>
              <div className="text-[11px] text-muted-foreground flex flex-col gap-0.5">
                <p>
                  {isUnlimited
                    ? '✨ باقة مفتوحة — عمليات استخراج غير محدودة'
                    : `استخدمت ${aiUsed} من أصل ${aiQuota} عملية — متبقي ${Math.max(0, aiQuota - aiUsed)} عمليات.`}
                </p>
                <p className="text-[10px] text-muted-foreground/80">
                  📅 يتجدد الرصيد تلقائياً في {currentUser.ai_renewal_date || 'بداية الشهر القادم'}.
                </p>
              </div>
            </div>

            {/* Subscription Validity */}
            <div className="flex flex-col justify-start md:items-end gap-1.5 border-t md:border-t-0 md:border-s border-border pt-3 md:pt-0 md:ps-6">
              <span className="text-[11px] text-muted-foreground">صلاحية وموعد انتهاء الاشتراك</span>
              <span className="text-xs font-bold text-foreground">
                {subInfo.text}
              </span>
              <button
                onClick={() => setShowPlansModal(true)}
                className="text-[11px] font-bold text-primary hover:underline self-start md:self-end mt-1 cursor-pointer"
              >
                + إدارة أو تجديد الاشتراك
              </button>
            </div>
          </div>

          {/* Policy & Service Separation Banner */}
          <div className="pt-3 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>
                <strong>التمايز بين الخدمات:</strong> رصيد الذكاء الاصطناعي مخصص فقط لاستخراج الجلسات، بينما تنبيهات WhatsApp و SMS تعمل بنظام منفصل تماماً.
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>سياسة الخصم: لا يُخصم أي رصيد عند فشل التحليل أو إعادة المحاولة</span>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          const value = (data as Record<string, number> | undefined)?.[stat.key];
          const isSessionStat = ['totalCases', 'todayHearings', 'upcomingHearings', 'finishedHearings'].includes(stat.key);
          const isUnavailable = isSessionStat && Boolean(sessionsError);

          return (
            <Link key={stat.key} href={stat.href}>
              <div
                className={`fade-in-up fade-in-up-delay-${i + 1} rounded-2xl border border-slate-200/80 dark:border-border bg-white dark:bg-card p-5 transition-all duration-200 hover:shadow-md hover:border-emerald-600/40 hover:-translate-y-0.5 cursor-pointer h-full flex flex-col justify-between shadow-xs`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-11 h-11 rounded-xl ${stat.iconBg} flex items-center justify-center shadow-xs`}>
                    <Icon className={`w-5 h-5 ${stat.iconColor}`} />
                  </div>
                  <div className={`w-2 h-2 rounded-full ${isUnavailable ? 'bg-amber-500' : stat.dotColor} mt-1`} />
                </div>
                <div>
                  {isLoading ? (
                    <Skeleton className="h-9 w-16 mb-1" />
                  ) : isUnavailable ? (
                    <div className="text-lg font-bold font-sans text-amber-600 dark:text-amber-400 py-1" data-testid={`stat-${stat.key}`}>
                      غير متاح
                    </div>
                  ) : (
                    <div className="text-3xl font-extrabold font-mono tracking-tight text-slate-900 dark:text-foreground" data-testid={`stat-${stat.key}`}>
                      {value ?? 0}
                    </div>
                  )}
                  <p className="text-xs text-slate-500 dark:text-muted-foreground mt-1.5 font-semibold">{stat.label}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Activity Section: Upcoming Hearings & Urgent Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Court Hearings (2 Cols on LG) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #093A2A, #0D4E3A)' }}>
                <Calendar className="w-3 h-3 text-amber-400" />
              </div>
              <h2 className="text-sm font-bold text-foreground">جلسات المحكمة القادمة واليوم</h2>
            </div>
            <Link href="/sessions" className="text-xs text-primary hover:underline flex items-center gap-1 font-semibold">
              <span>عرض جدول الجلسات</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isLoadingSessions ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3 text-muted-foreground text-xs">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
                <span>جارٍ تحميل جدول جلسات المحكمة من المصدر...</span>
              </div>
              {[1, 2].map((n) => (
                <div key={n} className="rounded-xl border border-border bg-card p-4">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-3 w-48" />
                </div>
              ))}
            </div>
          ) : sessionsError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/8 p-6 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
              <div>
                <h4 className="text-sm font-bold text-destructive">تعذر تحميل جدول جلسات المحكمة</h4>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  حدث خطأ أثناء محاولة الاتصال بـ Google Sheets لجلب الجلسات. لا يعني هذا أبداً عدم وجود جلسات لديك.
                </p>
              </div>
              <button
                onClick={() => refetchSessions()}
                className="text-xs font-bold px-4 py-2 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer shadow-xs inline-flex items-center gap-1.5 transition-colors"
              >
                <span>إعادة المحاولة الآن</span>
              </button>
            </div>
          ) : upcomingSessions.length > 0 ? (
            <div className="space-y-3">
              {upcomingSessions.map((session: Session) => (
                <Link key={session.id} href={`/sessions/${session.id}`}>
                  <div className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-primary/40 hover:shadow-xs cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Scale className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm font-mono text-foreground">{session.caseNumber || 'بدون رقم'}</span>
                          {session.court && (
                            <span className="text-[11px] text-muted-foreground">· {session.court}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                          {session.plaintiff && (
                            <span className="truncate max-w-[140px]">الموكل: {session.plaintiff}</span>
                          )}
                          {session.defendant && (
                            <span className="truncate max-w-[140px]">الخصم: {session.defendant}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <TimeRemainingBadge hearingAt={session.hearingAt} sessionDateHijri={session.sessionDateHijri} />
                      <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center space-y-3">
              <Calendar className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
              <p className="text-xs text-muted-foreground font-medium">لا توجد جلسات مجدولة لليوم أو الأيام القادمة حالياً.</p>
              <div className="flex items-center justify-center gap-3 pt-1">
                <Link href="/sessions">
                  <span className="text-xs font-bold text-primary hover:underline cursor-pointer">
                    + إضافة جلسة يدوياً
                  </span>
                </Link>
                <span className="text-muted-foreground text-xs">أو</span>
                <Link href="/chat">
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer">
                    ✨ استخراج من رسالة بالذكاء الاصطناعي
                  </span>
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Urgent Tasks (1 Col on LG) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #B88A3B, #D4A855)' }}>
                <CheckSquare className="w-3 h-3 text-white" />
              </div>
              <h2 className="text-sm font-bold text-foreground">المهام العاجلة</h2>
            </div>
            <Link href="/tasks" className="text-xs text-primary hover:underline flex items-center gap-1 font-semibold">
              <span>جميع المهام</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </Link>
          </div>

          {urgentTasks.length > 0 ? (
            <div className="space-y-2.5">
              {urgentTasks.map((task) => (
                <Link key={task.id} href="/tasks">
                  <div className="rounded-xl border border-border bg-card p-3.5 transition-all duration-200 hover:border-amber-500/40 hover:shadow-xs cursor-pointer space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-foreground line-clamp-1">{task.title}</span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                          task.priority === 'عاجل'
                            ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {task.priority}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>المكلف: {task.assignee || 'غير محدد'}</span>
                      {task.dueDate && <span>الموعد: {task.dueDate}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center space-y-3">
              <CheckCircle2 className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
              <p className="text-xs text-muted-foreground">جميع المهام مكتملة، لا توجد مهام معلقة!</p>
              <Link href="/tasks">
                <span className="inline-block text-xs font-bold text-primary hover:underline">
                  + إضافة مهمة قانونية جديدة
                </span>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Tasks Stats Section */}
      <div className="fade-in-up">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#B88A3B,#D4A855)' }}>
            <CheckSquare className="w-3 h-3 text-white" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">إحصائيات المهام</h2>
          <Link href="/tasks" className="mr-auto text-xs text-primary hover:underline flex items-center gap-0.5">
            عرض الكل <ArrowLeft className="w-3 h-3" />
          </Link>
        </div>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          {taskStats.map((stat, i) => {
            const Icon = stat.icon;
            const value = (data as Record<string, number> | undefined)?.[stat.key];
            return (
              <Link key={stat.key} href="/tasks">
                <div
                  className={`fade-in-up fade-in-up-delay-${i + 1} rounded-2xl border border-slate-200/80 dark:border-border bg-white dark:bg-card p-4 transition-all duration-200 hover:shadow-md hover:border-amber-500/40 hover:-translate-y-0.5 cursor-pointer h-full flex flex-col justify-between shadow-xs`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-10 h-10 rounded-xl ${stat.iconBg} flex items-center justify-center shadow-xs`}>
                      <Icon className={`w-5 h-5 ${stat.iconColor}`} />
                    </div>
                    <div className={`w-2 h-2 rounded-full ${stat.dotColor} mt-1`} />
                  </div>
                  <div>
                    {isLoading ? (
                      <Skeleton className="h-8 w-12 mb-1" />
                    ) : (
                      <div className="text-2xl font-extrabold font-mono tracking-tight text-slate-900 dark:text-foreground">{value ?? 0}</div>
                    )}
                    <p className="text-xs text-slate-500 dark:text-muted-foreground mt-1 font-medium">{stat.label}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="fade-in-up fade-in-up-delay-4 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Link href="/chat">
          <div
            className="group relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/8 to-primary/3 p-6 cursor-pointer transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:-translate-y-0.5 h-full"
            data-testid="link-analyze-message"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/25 transition-colors">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-base mb-1">تحليل رسالة جديدة</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  استخراج تفاصيل الجلسة من الرسالة النصية
                </div>
              </div>
            </div>
            <div className="absolute bottom-4 left-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowLeft className="w-4 h-4 text-primary" />
            </div>
          </div>
        </Link>

        <Link href="/sessions">
          <div
            className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 cursor-pointer transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:-translate-y-0.5 h-full"
            data-testid="link-view-sessions"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                <Calendar className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-base mb-1">عرض جميع الجلسات</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  تصفّح وإدارة جلسات الاستماع
                </div>
              </div>
            </div>
            <div className="absolute bottom-4 left-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </Link>

        <Link href="/poa">
          <div
            className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 cursor-pointer transition-all duration-200 hover:border-blue-500/30 hover:shadow-lg hover:-translate-y-0.5 h-full"
            data-testid="link-view-poa"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0 group-hover:bg-blue-500/20 transition-colors">
                <FileKey className="w-6 h-6 text-blue-500 transition-colors" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-base mb-1">إدارة الوكالات الشرعية</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  متابعة الوكالات وتواريخ الانتهاء
                </div>
              </div>
            </div>
            <div className="absolute bottom-4 left-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </Link>

        <Link href="/judgments">
          <div
            className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 cursor-pointer transition-all duration-200 hover:border-emerald-500/30 hover:shadow-lg hover:-translate-y-0.5 h-full"
            data-testid="link-view-judgments"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                <Gavel className="w-6 h-6 text-emerald-500 transition-colors" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-base mb-1">سجل الأحكام القضائية</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  متابعة القرارات والأحكام النهائية
                </div>
              </div>
            </div>
            <div className="absolute bottom-4 left-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </Link>
      </div>

      {/* Plan Comparison & Subscription Management Modal */}
      <Dialog open={showPlansModal} onOpenChange={setShowPlansModal}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Scale className="w-5 h-5 text-amber-500" />
              <span>مقارنة باقات الاشتراك والترقية للمكاتب</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              جدول شفاف يوضح الميزات الفعلية لكل باقة، حدود الاستخراج، وسعة الفريق دون أي ميزات وهمية
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="bg-muted/60 border-b border-border">
                    <th className="p-3 font-bold text-foreground">الميزة / الوظيفة</th>
                    <th className="p-3 font-bold text-emerald-700 dark:text-emerald-400">باقة بلس (Plus)</th>
                    <th className="p-3 font-bold text-amber-600 dark:text-amber-400">باقة برو (Pro) ⭐</th>
                    <th className="p-3 font-bold text-primary">المشرف المفتوح (Enterprise)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="p-3 font-semibold">عدد المحامين والمستخدمين</td>
                    <td className="p-3 text-muted-foreground">محامٍ واحد (حساب فردي)</td>
                    <td className="p-3 font-bold text-foreground">حتى 5 محامين ومساعدين</td>
                    <td className="p-3 font-bold text-foreground">غير محدود (فريق كامل)</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">استخراج رسائل الجلسات بالذكاء الاصطناعي</td>
                    <td className="p-3 text-muted-foreground">50 عملية شهرياً</td>
                    <td className="p-3 font-bold text-foreground">250 عملية شهرياً</td>
                    <td className="p-3 font-bold text-foreground">غير محدود (Unlimited)</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">تنبيهات WhatsApp و SMS التلقائية</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">متاحة ومجدولة (قبل 24 ساعة)</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">متاحة ومجدولة مع خيارات مخصصة</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">بوابة تنبيهات خاصة بالمكتب</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">تصدير تقارير الجلسات والأحكام</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">Excel + PDF متوفر</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">Excel + PDF + Word</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">تصدير كامل ونسخ احتياطي</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">إدارة الأتعاب والفواتير والمصروفات</td>
                    <td className="p-3 text-muted-foreground">تسجيل بسيط</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">شامل (فواتير، أقساط، ومطالبات)</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">نظام محاسبي متكامل للمكتب</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">مساحة حفظ المستندات والوكالات</td>
                    <td className="p-3 text-muted-foreground">5 جيجابايت</td>
                    <td className="p-3 font-bold text-foreground">50 جيجابايت</td>
                    <td className="p-3 font-bold text-foreground">500 جيجابايت سحابية مشفرة</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">سياسة الخصم عند فشل التحليل</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">صفر خصم عند الفشل</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">صفر خصم عند الفشل</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">صفر خصم عند الفشل</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">عزل البيانات والأمان السحابي</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">عزل كامل لمكتبك</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">عزل كامل + صلاحيات مخصصة</td>
                    <td className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">خادم خاص ومفاتيح مستقلة</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs space-y-2">
              <p className="font-bold text-amber-900 dark:text-amber-200">
                📌 اشتراكك الحالي: {isUnlimited ? 'باقة المشرف المفتوحة' : currentUser?.plan_tier === 'pro' ? 'باقة برو (Pro)' : 'باقة بلس (Plus)'}
              </p>
              <p className="text-muted-foreground">
                {subInfo.text}. لتجديد اشتراكك أو ترقية خطة مكتبك، يمكنك التواصل المباشر مع إدارة المنصة أو الدعم الفني، وسيتم تفعيل الباقة فوراً دون أي انقطاع في بياناتك.
              </p>
              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowPlansModal(false)}
                  className="px-4 py-1.5 rounded-lg border border-border bg-card text-foreground text-xs font-semibold hover:bg-accent cursor-pointer"
                >
                  إغلاق
                </button>
                <a
                  href={`https://wa.me/966500000000?text=${encodeURIComponent(`السلام عليكم، أرغب بتجديد/ترقية اشتراك منصة المحاماة لحسابي: ${currentUser?.username}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                >
                  <span>طلب التجديد عبر الواتساب</span>
                </a>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
