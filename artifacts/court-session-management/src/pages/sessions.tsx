import { useState, useEffect, useMemo } from 'react';
import {
  useListSessions,
  useDeleteSession,
  useUpdateSession,
  useCreateSession,
  getListSessionsQueryKey,
  getGetDashboardStatsQueryKey,
} from '@workspace/api-client-react';
import type { SessionStatus } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'wouter';
import {
  Calendar,
  Plus,
  Scale,
  Clock,
  User,
  MoreVertical,
  Pencil,
  Trash2,
  ArrowUpDown,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  List,
  CalendarDays,
  UserCheck,
} from 'lucide-react';
import { TimeRemainingBadge } from '@/components/time-remaining';
import { sortSessions, type SortOption } from '@/lib/session-sort';
import { getArabicDayName } from '@/lib/hijri';
import {
  validateDateInput,
  normalizeArabicNumerals,
  type CalendarType,
} from '@/lib/date-validation';
import { TeamMemberSelect } from '@/components/team-select';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const statusOptions: { value: SessionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'Today', label: 'اليوم' },
  { value: 'Upcoming', label: 'قادمة' },
  { value: 'Finished', label: 'منتهية' },
  { value: 'Cancelled', label: 'ملغية' },
];

function deriveEffectiveStatus(
  storedStatus: SessionStatus,
  hearingAt: string | null | undefined,
): SessionStatus {
  if (storedStatus === 'Cancelled' || storedStatus === 'Finished') return storedStatus;
  if (!hearingAt) return storedStatus;
  const hearing = new Date(hearingAt);
  const now = new Date();
  if (hearing.getTime() < now.getTime()) return 'Finished';
  const sameDay =
    hearing.getUTCFullYear() === now.getUTCFullYear() &&
    hearing.getUTCMonth() === now.getUTCMonth() &&
    hearing.getUTCDate() === now.getUTCDate();
  return sameDay ? 'Today' : 'Upcoming';
}

const statusLabelMap: Record<SessionStatus, string> = {
  Today: 'اليوم',
  Upcoming: 'قادمة',
  Finished: 'منتهية',
  Cancelled: 'ملغية',
};

const statusStyleMap: Record<SessionStatus, { badge: string; dot: string }> = {
  Today: {
    badge: 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/20',
    dot: 'bg-emerald-600',
  },
  Upcoming: {
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    dot: 'bg-emerald-500',
  },
  Finished: {
    badge: 'bg-muted text-muted-foreground border-border',
    dot: 'bg-muted-foreground',
  },
  Cancelled: {
    badge: 'bg-destructive/10 text-destructive border-destructive/20',
    dot: 'bg-destructive',
  },
};

const quickEditFields = [
  { key: 'caseNumber', label: 'رقم القضية', dir: 'ltr' as const, mono: true },
  { key: 'plaintiff', label: 'المدّعي', dir: 'rtl' as const },
  { key: 'defendant', label: 'المدّعى عليه', dir: 'rtl' as const },
  { key: 'court', label: 'المحكمة', dir: 'rtl' as const },
  { key: 'sessionDateHijri', label: 'تاريخ الجلسة', dir: 'ltr' as const, mono: true },
  { key: 'sessionTime', label: 'وقت الجلسة', dir: 'ltr' as const, mono: true },
];

type SessionItem = {
  id: number;
  caseNumber?: string | null;
  plaintiff?: string | null;
  defendant?: string | null;
  court?: string | null;
  courtCircuit?: string | null;
  sessionDateHijri?: string | null;
  sessionDay?: string | null;
  sessionTime?: string | null;
  assignedLawyer?: string | null;
  assigneeId?: string | null;
  status: SessionStatus;
  hearingAt?: string | null;
  [key: string]: unknown;
};

interface ConflictItem {
  id: number;
  caseNumber: string;
  court: string;
  sessionDateHijri: string;
  sessionTime: string | null;
  assignedLawyer?: string | null;
  reason: string;
}

export default function SessionsPage() {
  const [statusFilter, setStatusFilter] = useState<SessionStatus | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('nearest');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [lawyerFilter, setLawyerFilter] = useState<string>('all');

  const [deleteTarget, setDeleteTarget] = useState<SessionItem | null>(null);
  const [editTarget, setEditTarget] = useState<SessionItem | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sessions, isLoading, error, refetch } = useListSessions(
    statusFilter === 'all' ? undefined : { status: statusFilter },
  );

  const rawSortedSessions = useMemo(
    () => (Array.isArray(sessions) ? sortSessions(sessions, sortBy) : []),
    [sessions, sortBy],
  );

  const distinctLawyers = useMemo(() => {
    const names = new Set<string>();
    for (const s of rawSortedSessions as unknown as SessionItem[]) {
      if (s.assignedLawyer && String(s.assignedLawyer).trim()) {
        names.add(String(s.assignedLawyer).trim());
      }
    }
    return Array.from(names);
  }, [rawSortedSessions]);

  const sortedSessions = useMemo(() => {
    if (lawyerFilter === 'all') return rawSortedSessions as unknown as SessionItem[];
    return (rawSortedSessions as unknown as SessionItem[]).filter(
      (s) => (s.assignedLawyer || '').trim() === lawyerFilter,
    );
  }, [rawSortedSessions, lawyerFilter]);

  // Group sessions chronologically by date for the Team Calendar View
  const calendarGroups = useMemo(() => {
    const map = new Map<string, { label: string; dayName: string; items: SessionItem[] }>();
    for (const s of sortedSessions) {
      const dateKey = s.sessionDateHijri || (s.hearingAt ? s.hearingAt.slice(0, 10) : 'بدون تاريخ');
      const dayName = getArabicDayName(s as any) || '';
      if (!map.has(dateKey)) {
        map.set(dateKey, { label: dateKey, dayName, items: [] });
      }
      map.get(dateKey)!.items.push(s);
    }
    return Array.from(map.values());
  }, [sortedSessions]);

  const deleteMutation = useDeleteSession();
  const updateMutation = useUpdateSession();
  const createMutation = useCreateSession();

  // Manual Session State
  const [showAddModal, setShowAddModal] = useState(false);
  const [calendarType, setCalendarType] = useState<CalendarType>('hijri');
  const [addForm, setAddForm] = useState({
    caseNumber: '',
    court: '',
    courtCircuit: '',
    sessionDateHijri: '',
    sessionTime: '',
    sessionType: 'حضوري',
    plaintiff: '',
    defendant: '',
    assignedLawyer: '',
    assigneeId: null as string | null,
    notes: '',
  });
  const [dateValidation, setDateValidation] = useState<{ isValid: boolean; message?: string }>({
    isValid: true,
  });
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);

  // Live Schedule Conflict Detection (Audit #43, #44)
  useEffect(() => {
    if (!showAddModal || !addForm.sessionDateHijri.trim() || !dateValidation.isValid) {
      setConflicts([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch('/api/sessions/check-conflicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sessionDateHijri: addForm.sessionDateHijri,
          sessionTime: addForm.sessionTime || null,
          assignedLawyer: addForm.assignedLawyer || null,
        }),
      })
        .then((r) => (r.ok ? r.json() : { conflicts: [] }))
        .then((data) => {
          setConflicts(Array.isArray(data?.conflicts) ? data.conflicts : []);
        })
        .catch(() => setConflicts([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [
    showAddModal,
    addForm.sessionDateHijri,
    addForm.sessionTime,
    addForm.assignedLawyer,
    dateValidation.isValid,
  ]);

  const handleDateChange = (rawVal: string) => {
    const val = normalizeArabicNumerals(rawVal);
    setAddForm((prev) => ({ ...prev, sessionDateHijri: val }));
    if (!val.trim()) {
      setDateValidation({ isValid: false, message: 'تاريخ الجلسة حقل إلزامي' });
    } else {
      const res = validateDateInput(val, calendarType);
      setDateValidation(res);
    }
  };

  const handleCreateSession = () => {
    if (!addForm.caseNumber.trim()) {
      toast({ title: 'حقل ناقص', description: 'يرجى إدخال رقم القضية', variant: 'destructive' });
      return;
    }
    if (!addForm.court.trim()) {
      toast({ title: 'حقل ناقص', description: 'يرجى إدخال المحكمة', variant: 'destructive' });
      return;
    }
    if (!addForm.sessionDateHijri.trim() || !dateValidation.isValid) {
      toast({
        title: 'تاريخ غير صالح',
        description: dateValidation.message || 'يرجى إدخال تاريخ صحيح',
        variant: 'destructive',
      });
      return;
    }

    createMutation.mutate(
      {
        data: {
          caseNumber: normalizeArabicNumerals(addForm.caseNumber.trim()),
          court: addForm.court.trim(),
          courtCircuit: addForm.courtCircuit.trim() || undefined,
          sessionDateHijri: normalizeArabicNumerals(addForm.sessionDateHijri.trim()),
          sessionTime: normalizeArabicNumerals(addForm.sessionTime.trim()) || undefined,
          sessionType: addForm.sessionType as any,
          plaintiff: addForm.plaintiff.trim() || undefined,
          defendant: addForm.defendant.trim() || undefined,
          notes: addForm.notes.trim() || undefined,
          ...(addForm.assignedLawyer ? { assignedLawyer: addForm.assignedLawyer } : {}),
          ...(addForm.assigneeId ? { assigneeId: addForm.assigneeId } : {}),
        } as any,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
          toast({
            title: 'تمت الإضافة بنجاح',
            description: 'تم حفظ الجلسة وتثبيتها في جدول المكتب.',
          });
          setShowAddModal(false);
          setAddForm({
            caseNumber: '',
            court: '',
            courtCircuit: '',
            sessionDateHijri: '',
            sessionTime: '',
            sessionType: 'حضوري',
            plaintiff: '',
            defendant: '',
            assignedLawyer: '',
            assigneeId: null,
            notes: '',
          });
          setConflicts([]);
          setDateValidation({ isValid: true });
        },
        onError: (err: any) => {
          const serverMsg = err?.data?.error || err?.message || 'تعذر حفظ الجلسة';
          toast({ title: 'فشل الحفظ', description: serverMsg, variant: 'destructive' });
        },
      },
    );
  };

  const openEdit = (session: SessionItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditForm({
      caseNumber: session.caseNumber || '',
      plaintiff: session.plaintiff || '',
      defendant: session.defendant || '',
      court: session.court || '',
      courtCircuit: (session.courtCircuit as string) || '',
      sessionDateHijri: session.sessionDateHijri || '',
      sessionTime: session.sessionTime || '',
      assignedLawyer: session.assignedLawyer || '',
      assigneeId: session.assigneeId || null,
      status: session.status,
    });
    setEditTarget(session);
  };

  const openDelete = (session: SessionItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteTarget(session);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
          toast({ title: 'تم الحذف', description: 'تم نقل الجلسة إلى سلة المحذوفات بنجاح' });
          setDeleteTarget(null);
        },
        onError: (err: any) => {
          toast({
            title: 'فشل الحذف',
            description: err?.data?.error || err?.message || 'تعذّر حذف الجلسة',
            variant: 'destructive',
          });
          setDeleteTarget(null);
        },
      },
    );
  };

  const handleEditSave = () => {
    if (!editTarget) return;
    updateMutation.mutate(
      {
        id: editTarget.id,
        data: {
          ...editForm,
          caseNumber: normalizeArabicNumerals(editForm.caseNumber || ''),
          sessionDateHijri: normalizeArabicNumerals(editForm.sessionDateHijri || ''),
          sessionTime: normalizeArabicNumerals(editForm.sessionTime || ''),
        } as any,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
          toast({ title: 'تم الحفظ', description: 'تم تحديث بيانات الجلسة بنجاح' });
          setEditTarget(null);
        },
        onError: (err: any) => {
          toast({
            title: 'فشل الحفظ',
            description: err?.data?.error || err?.message || 'تعذّر تحديث الجلسة',
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-6" dir="rtl">
      {/* Header */}
      <div className="fade-in-up flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-6 rounded-full bg-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">جلسات المحكمة</h1>
          </div>
          <p className="text-muted-foreground text-sm mr-3">
            إدارة جدول الجلسات وتقويم الفريق وكشف تعارض المواعيد تلقائياً
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* View Mode Toggle: List vs Team Calendar */}
          <div className="flex items-center bg-muted p-1 rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-card text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              قائمة
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'calendar'
                  ? 'bg-card text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              data-testid="button-calendar-view"
            >
              <CalendarDays className="w-3.5 h-3.5" />
              تقويم الفريق
            </button>
          </div>

          <Button
            size="sm"
            onClick={() => setShowAddModal(true)}
            className="gap-2 shadow-sm font-semibold cursor-pointer"
            data-testid="button-add-session-manual"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة جلسة يدويًا</span>
          </Button>
          <Link href="/chat">
            <Button
              size="sm"
              variant="outline"
              className="gap-2 shadow-sm border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>استخراج بالذكاء الاصطناعي</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter Tabs, Lawyer Filter & Sort Dropdown */}
      <div className="fade-in-up fade-in-up-delay-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 p-1 bg-muted rounded-xl border border-border w-fit">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              data-testid={`filter-${option.value}`}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                statusFilter === option.value
                  ? 'bg-card text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {distinctLawyers.length > 0 && (
            <Select value={lawyerFilter} onValueChange={setLawyerFilter}>
              <SelectTrigger className="h-9 text-xs gap-1.5 bg-card border-border min-w-[160px]">
                <UserCheck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <SelectValue placeholder="تصفية حسب المحامي" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all">كل فريق المكتب</SelectItem>
                {distinctLawyers.map((lw) => (
                  <SelectItem key={lw} value={lw}>
                    {lw}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger
              className="h-9 text-xs gap-1.5 bg-card border-border min-w-[170px]"
              data-testid="select-sort-sessions"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="الترتيب" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="nearest">الأقرب زمناً (تلقائي)</SelectItem>
              <SelectItem value="furthest">الأبعد زمناً</SelectItem>
              <SelectItem value="newest">أحدث مضافاً</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content Rendering: Loading -> Error -> Calendar/List -> Empty */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start gap-4">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="fade-in-up rounded-2xl border border-destructive/30 bg-destructive/8 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-destructive/15 text-destructive flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-destructive">تعذر تحميل قائمة الجلسات</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
              {(error as any)?.data?.error ||
                'تعذر الاتصال بمصدر بيانات المكتب لجلب الجلسات. يرجى التحقق من حالة الربط أو إعادة المحاولة.'}
            </p>
          </div>
          <Button
            onClick={() => refetch()}
            variant="outline"
            className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            إعادة محاولة التحميل
          </Button>
        </div>
      ) : sortedSessions.length > 0 ? (
        viewMode === 'calendar' ? (
          /* ── Team Schedule Calendar View ── */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 fade-in-up">
            {calendarGroups.map((group) => (
              <div
                key={group.label}
                className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col shadow-xs"
              >
                <div className="px-4 py-3 bg-muted/50 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-primary" />
                    <span className="font-bold text-sm text-foreground">{group.dayName}</span>
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {group.label}
                    </span>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {group.items.length} جلسة
                  </span>
                </div>
                <div className="p-3 space-y-2.5 flex-1">
                  {group.items.map((session) => {
                    const effectiveStatus = deriveEffectiveStatus(
                      session.status,
                      session.hearingAt,
                    );
                    const style = statusStyleMap[effectiveStatus];
                    return (
                      <Link key={session.id} href={`/sessions/${session.id}`}>
                        <div className="rounded-xl border border-border/70 bg-background/60 p-3 hover:border-primary/40 transition-all cursor-pointer space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-bold text-xs text-foreground">
                              {session.caseNumber || `#${session.id}`}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${style.badge}`}
                            >
                              {session.sessionTime || statusLabelMap[effectiveStatus]}
                            </span>
                          </div>
                          {session.court && (
                            <p className="text-xs text-muted-foreground truncate">{session.court}</p>
                          )}
                          {session.assignedLawyer && (
                            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                              <UserCheck className="w-3 h-3" />
                              {session.assignedLawyer}
                            </p>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ── Standard Chronological List View ── */
          <div className="space-y-3 fade-in-up fade-in-up-delay-2">
            {sortedSessions.map((session, i) => {
              const effectiveStatus = deriveEffectiveStatus(session.status, session.hearingAt);
              const style = statusStyleMap[effectiveStatus];
              return (
                <div
                  key={session.id}
                  className="relative group"
                  style={{ animationDelay: `${i * 0.04}s` }}
                >
                  <Link href={`/sessions/${session.id}`}>
                    <div className="rounded-xl border border-border bg-card p-5 cursor-pointer transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5">
                      <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                          <Scale className="w-5 h-5 text-primary" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3
                                className="font-bold text-base font-mono text-foreground"
                                data-testid={`session-case-${session.id}`}
                              >
                                {session.caseNumber || '—'}
                              </h3>
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style.badge}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                                {statusLabelMap[effectiveStatus]}
                              </span>
                              {session.assignedLawyer && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-foreground border border-border">
                                  <UserCheck className="w-3 h-3 text-emerald-500" />
                                  {session.assignedLawyer}
                                </span>
                              )}
                            </div>
                            <div className="w-8 h-8 shrink-0" />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                            {session.plaintiff && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <User className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{session.plaintiff}</span>
                                {session.defendant && (
                                  <span className="text-muted-foreground/50">←</span>
                                )}
                                {session.defendant && (
                                  <span className="truncate">{session.defendant}</span>
                                )}
                              </div>
                            )}
                            {session.court && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Scale className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{session.court}</span>
                              </div>
                            )}
                            {(session.sessionDateHijri || session.hearingAt) && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Calendar className="w-3.5 h-3.5 shrink-0" />
                                {getArabicDayName(session as any) && (
                                  <span className="font-medium text-foreground">
                                    {getArabicDayName(session as any)}
                                  </span>
                                )}
                                {getArabicDayName(session as any) && session.sessionDateHijri && (
                                  <span className="text-muted-foreground/50">·</span>
                                )}
                                {session.sessionDateHijri && (
                                  <span className="font-mono">{session.sessionDateHijri}</span>
                                )}
                                {session.sessionTime && (
                                  <span className="font-mono text-muted-foreground/70">
                                    · {session.sessionTime}
                                  </span>
                                )}
                              </div>
                            )}
                            {session.hearingAt && (
                              <div className="flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <TimeRemainingBadge hearingAt={session.hearingAt} />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>

                  <div className="absolute top-4 left-4 z-10">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all duration-150 focus:opacity-100 focus:outline-none"
                          data-testid={`button-session-menu-${session.id}`}
                          aria-label="خيارات الجلسة"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={(e) => openEdit(session, e)}
                          className="gap-2 cursor-pointer"
                          data-testid={`button-edit-session-${session.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          تعديل سريع
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => openDelete(session, e)}
                          className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                          data-testid={`button-delete-session-${session.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          حذف الجلسة
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* ── Empty State: Direct Manual Entry without AI Dependency! (Audit #43) ── */
        <div className="fade-in-up fade-in-up-delay-2 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
            <Calendar className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">لا توجد جلسات مسجلة</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            {statusFilter === 'all'
              ? 'يمكنك إضافة جلسة جديدة مباشرة بشكل يدوي أو استخراجها تلقائياً من رسالة المحكمة.'
              : `لا توجد جلسات بحالة "${statusLabelMap[statusFilter as SessionStatus] ?? statusFilter}"`}
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Button
              onClick={() => setShowAddModal(true)}
              className="gap-2"
              data-testid="button-add-session"
            >
              <Plus className="w-4 h-4" />
              إضافة جلسة جديدة يدوياً
            </Button>
            <Link href="/chat">
              <Button variant="outline" className="gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                استخراج من رسالة محكمة
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الجلسة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من نقل الجلسة{' '}
              {deleteTarget?.caseNumber ? (
                <span className="font-mono font-semibold text-foreground">
                  {deleteTarget.caseNumber}
                </span>
              ) : (
                'المحددة'
              )}{' '}
              إلى سلة المحذوفات؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? 'جارٍ الحذف...' : 'تأكيد الحذف'}
            </AlertDialogAction>
            <AlertDialogCancel data-testid="button-cancel-delete">إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Quick Edit Dialog */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Pencil className="w-4 h-4 text-primary" />
              </div>
              تعديل الجلسة
              {editTarget?.caseNumber && (
                <span className="font-mono text-sm text-muted-foreground font-normal">
                  — {editTarget.caseNumber}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">الحالة</Label>
              <Select
                value={editForm.status}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, status: value }))}
              >
                <SelectTrigger className="h-9 text-sm" data-testid="quick-edit-select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="Upcoming">قادمة</SelectItem>
                  <SelectItem value="Today">اليوم</SelectItem>
                  <SelectItem value="Finished">منتهية</SelectItem>
                  <SelectItem value="Cancelled">ملغية</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {quickEditFields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label
                    htmlFor={`quick-edit-${f.key}`}
                    className="text-xs font-semibold text-muted-foreground"
                  >
                    {f.label}
                  </Label>
                  <Input
                    id={`quick-edit-${f.key}`}
                    value={editForm[f.key] || ''}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        [f.key]: f.mono
                          ? normalizeArabicNumerals(e.target.value)
                          : e.target.value,
                      }))
                    }
                    className={`${f.mono ? 'font-mono' : ''} h-9 text-sm`}
                    dir={f.dir}
                    data-testid={`quick-edit-input-${f.key}`}
                  />
                </div>
              ))}
            </div>

            <TeamMemberSelect
              id="quick-edit-lawyer"
              label="المحامي المكلف بالحضور"
              value={editForm.assignedLawyer || ''}
              assigneeId={editForm.assigneeId || null}
              onChange={(name, memberId) =>
                setEditForm((prev) => ({
                  ...prev,
                  assignedLawyer: name,
                  assigneeId: memberId || null,
                }))
              }
            />
          </div>

          <DialogFooter className="gap-2 flex-row-reverse">
            <Button
              onClick={handleEditSave}
              disabled={updateMutation.isPending}
              className="gap-2 flex-1"
              data-testid="button-quick-edit-save"
            >
              {updateMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              disabled={updateMutation.isPending}
              data-testid="button-quick-edit-cancel"
            >
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Session Entry Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Plus className="w-4 h-4 text-primary" />
              </div>
              <span>إضافة جلسة محكمة يدويًا</span>
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              إدخال تفاصيل الجلسة مباشرة مع فحص فوري لتعارض مواعيد المحامين والتحقق من التاريخ
            </p>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  رقم القضية <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={addForm.caseNumber}
                  onChange={(e) =>
                    setAddForm((p) => ({
                      ...p,
                      caseNumber: normalizeArabicNumerals(e.target.value),
                    }))
                  }
                  placeholder="مثال: 441029384"
                  className="font-mono h-9 text-sm"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  المحكمة <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={addForm.court}
                  onChange={(e) => setAddForm((p) => ({ ...p, court: e.target.value }))}
                  placeholder="مثال: المحكمة العامة بالرياض"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">الدائرة القضائية</Label>
                <Input
                  value={addForm.courtCircuit}
                  onChange={(e) => setAddForm((p) => ({ ...p, courtCircuit: e.target.value }))}
                  placeholder="مثال: الدائرة الحقوقية الثالثة"
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">نوع الحضور</Label>
                <Select
                  value={addForm.sessionType}
                  onValueChange={(v) => setAddForm((p) => ({ ...p, sessionType: v }))}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="حضوري">حضوري بمقر المحكمة</SelectItem>
                    <SelectItem value="عن بُعد">عن بُعد (جلسة إلكترونية)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date Input with Calendar Switch & Live Validation */}
            <div className="space-y-2 p-3.5 rounded-xl border border-border bg-muted/20">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground">
                  تاريخ ووقت الجلسة <span className="text-destructive">*</span>
                </Label>
                <div className="flex items-center gap-1 bg-background p-1 rounded-lg border border-border text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setCalendarType('hijri');
                      if (addForm.sessionDateHijri) {
                        setDateValidation(validateDateInput(addForm.sessionDateHijri, 'hijri'));
                      }
                    }}
                    className={`px-2.5 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                      calendarType === 'hijri'
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    هجري
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCalendarType('gregorian');
                      if (addForm.sessionDateHijri) {
                        setDateValidation(validateDateInput(addForm.sessionDateHijri, 'gregorian'));
                      }
                    }}
                    className={`px-2.5 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                      calendarType === 'gregorian'
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    ميلادي
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Input
                    value={addForm.sessionDateHijri}
                    onChange={(e) => handleDateChange(e.target.value)}
                    placeholder={
                      calendarType === 'hijri' ? 'مثال: 15/04/1448' : 'مثال: 25/10/2026'
                    }
                    className={`font-mono h-9 text-sm ${
                      !dateValidation.isValid
                        ? 'border-destructive focus-visible:ring-destructive'
                        : ''
                    }`}
                    dir="ltr"
                  />
                  {!dateValidation.isValid && dateValidation.message && (
                    <p className="text-[11px] text-destructive mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{dateValidation.message}</span>
                    </p>
                  )}
                  {dateValidation.isValid && addForm.sessionDateHijri && (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        تاريخ سليم ومعتمد ({calendarType === 'hijri' ? 'تقويم هجري' : 'تقويم ميلادي'}
                        )
                      </span>
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Input
                    value={addForm.sessionTime}
                    onChange={(e) =>
                      setAddForm((p) => ({
                        ...p,
                        sessionTime: normalizeArabicNumerals(e.target.value),
                      }))
                    }
                    placeholder="وقت الجلسة (مثال: 09:30 ص)"
                    className="font-mono h-9 text-sm"
                    dir="ltr"
                  />
                </div>
              </div>
            </div>

            {/* Live Schedule Conflict Warning Box */}
            {conflicts.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-1.5 text-xs">
                <div className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>تنبيه تعارض محتمل في جدول الجلسات ({conflicts.length})</span>
                </div>
                <ul className="space-y-1 text-muted-foreground pr-5 list-disc">
                  {conflicts.map((c) => (
                    <li key={c.id}>
                      قضية <span className="font-mono font-bold text-foreground">{c.caseNumber}</span>{' '}
                      في {c.court} {c.sessionTime ? `الساعة ${c.sessionTime}` : ''} — {c.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  اسم الموكل (المدعي/المدعى عليه)
                </Label>
                <Input
                  value={addForm.plaintiff}
                  onChange={(e) => setAddForm((p) => ({ ...p, plaintiff: e.target.value }))}
                  placeholder="اسم موكل المكتب"
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  اسم الخصم / الطرف الآخر
                </Label>
                <Input
                  value={addForm.defendant}
                  onChange={(e) => setAddForm((p) => ({ ...p, defendant: e.target.value }))}
                  placeholder="اسم الخصم"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <TeamMemberSelect
              id="add-session-lawyer"
              label="المحامي المسؤول / المكلف بالحضور"
              value={addForm.assignedLawyer}
              assigneeId={addForm.assigneeId}
              onChange={(name, memberId) =>
                setAddForm((p) => ({
                  ...p,
                  assignedLawyer: name,
                  assigneeId: memberId || null,
                }))
              }
            />

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">
                موضوع الجلسة وملاحظات إضافية
              </Label>
              <Input
                value={addForm.notes}
                onChange={(e) => setAddForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="ملاحظات المرافعة، الدفوع، أو طلبات الدائرة..."
                className="h-9 text-sm"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 flex-row-reverse pt-2">
            <Button
              onClick={handleCreateSession}
              disabled={
                createMutation.isPending ||
                !addForm.caseNumber.trim() ||
                !addForm.court.trim() ||
                !addForm.sessionDateHijri.trim() ||
                !dateValidation.isValid
              }
              className="gap-2 flex-1 cursor-pointer font-bold"
            >
              {createMutation.isPending ? 'جارٍ الحفظ في الجدول...' : 'حفظ الجلسة الآن'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowAddModal(false)}
              disabled={createMutation.isPending}
              className="cursor-pointer"
            >
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
