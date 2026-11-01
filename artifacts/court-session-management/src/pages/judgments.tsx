import { useState, useEffect, useCallback } from 'react';
import { getArabicDayName } from '@/lib/hijri';
import {
  Gavel,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  User,
  Scale,
  Search,
  Edit3,
  Loader2,
  RefreshCw,
  CheckCircle2,
  FileText,
  UserCheck,
  CloudOff,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { DateField } from '@/components/date-field';
import { TeamMemberSelect } from '@/components/team-select';
import { normalizeArabicNumerals } from '@/lib/date-validation';
import {
  readUserScopedJson,
  writeUserScopedJson,
  readUserScopedString,
  writeUserScopedString,
} from '@/lib/user-storage';

export interface JudgmentRecord {
  id: number;
  caseNumber?: string;
  court: string;
  plaintiff: string;
  defendant: string;
  assignedLawyer: string;
  assigneeId?: string | null;
  judgmentNumber: string;
  judgmentDate: string;
  summary: string;
  judgmentType?: 'نهائي' | 'ابتدائي';
  rulingOutcome?: 'لصالحنا' | 'ضدنا' | 'قيد الدراسة';
  isFavorable: 'نهائي' | 'ابتدائي' | 'نعم' | 'لا' | string;
  createdAt: string;
}

export default function JudgmentsPage() {
  const { toast } = useToast();
  const { data: currentUser } = useGetCurrentUser();
  const userIdentity = currentUser as any;

  const [records, setRecords] = useState<JudgmentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [fetchError, setFetchError] = useState<{ message: string; refCode?: string } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [recentlySavedId, setRecentlySavedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterResult, setFilterResult] = useState<'all' | 'نهائي' | 'ابتدائي' | 'لصالحنا' | 'ضدنا'>('all');
  const [isOpen, setIsOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<JudgmentRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JudgmentRecord | null>(null);

  // Form State
  const [caseNumber, setCaseNumber] = useState('');
  const [court, setCourt] = useState('');
  const [plaintiff, setPlaintiff] = useState('');
  const [defendant, setDefendant] = useState('');
  const [assignedLawyer, setAssignedLawyer] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [judgmentNumber, setJudgmentNumber] = useState('');
  const [judgmentDate, setJudgmentDate] = useState('');
  const [summary, setSummary] = useState('');
  const [judgmentType, setJudgmentType] = useState<'نهائي' | 'ابتدائي'>('نهائي');
  const [rulingOutcome, setRulingOutcome] = useState<'لصالحنا' | 'ضدنا' | 'قيد الدراسة'>('لصالحنا');

  const loadRecords = useCallback(
    async (isManualRefresh = false) => {
      if (!userIdentity) return;
      if (isManualRefresh) setIsLoading(true);
      const cachedSync = readUserScopedString('judgments_synced_at', userIdentity);
      if (cachedSync) setLastSyncedAt(cachedSync);

      try {
        const url = isManualRefresh ? '/api/judgments?refresh=true' : '/api/judgments';
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) {
          const data: JudgmentRecord[] = await res.json();
          const syncedHeader = res.headers.get('X-Synced-At') || new Date().toISOString();
          setRecords(Array.isArray(data) ? data : []);
          setFetchError(null);
          setLastSyncedAt(syncedHeader);
          writeUserScopedJson('judgments_confirmed', userIdentity, data);
          writeUserScopedString('judgments_synced_at', userIdentity, syncedHeader);
        } else {
          const errBody = await res.json().catch(() => ({}));
          setFetchError({
            message: errBody.error || 'تعذر تحميل سجل الأحكام القضائية من الخادم حالياً.',
            refCode: errBody.referenceCode,
          });
          setRecords(readUserScopedJson<JudgmentRecord[]>('judgments_confirmed', userIdentity, []));
        }
      } catch {
        setFetchError({
          message: 'تعذر الاتصال بالخادم لجلب الأحكام. يتم عرض آخر نسخة محفوظة لحساب المكتب.',
        });
        setRecords(readUserScopedJson<JudgmentRecord[]>('judgments_confirmed', userIdentity, []));
      } finally {
        setIsLoading(false);
      }
    },
    [userIdentity],
  );

  useEffect(() => {
    if (userIdentity) {
      loadRecords();
    }
  }, [loadRecords, userIdentity]);

  const handleOpenCreate = () => {
    setEditingRecord(null);
    setCaseNumber('');
    setCourt('');
    setPlaintiff('');
    setDefendant('');
    setAssignedLawyer('');
    setAssigneeId(null);
    setJudgmentNumber('');
    setJudgmentDate('');
    setSummary('');
    setJudgmentType('نهائي');
    setRulingOutcome('لصالحنا');
    setIsOpen(true);
  };

  const handleOpenEdit = (rec: JudgmentRecord) => {
    setEditingRecord(rec);
    setCaseNumber(rec.caseNumber || '');
    setCourt(rec.court || '');
    setPlaintiff(rec.plaintiff || '');
    setDefendant(rec.defendant || '');
    setAssignedLawyer(rec.assignedLawyer || '');
    setAssigneeId(rec.assigneeId || null);
    setJudgmentNumber(rec.judgmentNumber || '');
    setJudgmentDate(rec.judgmentDate || '');
    setSummary(rec.summary || '');
    setJudgmentType(
      rec.judgmentType === 'ابتدائي' || rec.isFavorable === 'ابتدائي' || rec.isFavorable === 'لا'
        ? 'ابتدائي'
        : 'نهائي',
    );
    setRulingOutcome(
      rec.rulingOutcome === 'ضدنا'
        ? 'ضدنا'
        : rec.rulingOutcome === 'قيد الدراسة'
          ? 'قيد الدراسة'
          : 'لصالحنا',
    );
    setIsOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!judgmentNumber.trim()) {
      toast({
        title: 'تنبيه',
        description: 'يرجى إدخال رقم الصك.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        caseNumber: normalizeArabicNumerals(caseNumber.trim()),
        court: court.trim(),
        plaintiff: plaintiff.trim(),
        defendant: defendant.trim(),
        assignedLawyer: assignedLawyer.trim(),
        assigneeId,
        judgmentNumber: normalizeArabicNumerals(judgmentNumber.trim()),
        judgmentDate: normalizeArabicNumerals(judgmentDate.trim()),
        summary: summary.trim(),
        judgmentType,
        rulingOutcome,
        isFavorable: judgmentType,
      };

      let res: Response;
      if (editingRecord) {
        res = await fetch(`/api/judgments/${editingRecord.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/judgments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': `judgment-${payload.judgmentNumber}-${Date.now()}`,
          },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const refSuffix = errorData.referenceCode ? ` (المرجع: ${errorData.referenceCode})` : '';
        throw new Error((errorData.error || 'فشل حفظ الحكم.') + refSuffix);
      }

      const savedData: JudgmentRecord | null = await res.json().catch(() => null);

      toast({
        title: editingRecord ? 'تم تحديث الصك بنجاح' : 'تم اعتماد وحفظ صك الحكم',
        description: `صك رقم (${payload.judgmentNumber}) — ${rulingOutcome} (${judgmentType}) تم تثبيته في سجل المكتب.`,
      });

      if (savedData && savedData.id) {
        setRecentlySavedId(savedData.id);
        setTimeout(() => setRecentlySavedId(null), 6000);
        setRecords((prev) =>
          editingRecord
            ? prev.map((r) => (r.id === savedData.id ? savedData : r))
            : [savedData, ...prev],
        );
      }

      // Close modal ONLY after confirmed server save! (Audit #18)
      setIsOpen(false);
      await loadRecords(true);
    } catch (err: any) {
      toast({
        title: 'تعذر حفظ الحكم',
        description: err.message || 'فشل حفظ الحكم؛ مدخلاتك ما زالت محفوظة في النموذج.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    try {
      const res = await fetch(`/api/judgments/${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'فشل حذف الحكم من الخادم.');
      }

      toast({
        title: 'تم الحذف',
        description: 'تم نقل صك الحكم إلى سلة المحذوفات بنجاح.',
      });

      setDeleteTarget(null);
      await loadRecords(true);
    } catch (err: any) {
      toast({
        title: 'خطأ',
        description: err.message || 'فشل عملية الحذف.',
        variant: 'destructive',
      });
    }
  };

  const resolveDegree = (r: JudgmentRecord): 'نهائي' | 'ابتدائي' =>
    r.judgmentType === 'ابتدائي' || r.isFavorable === 'ابتدائي' || r.isFavorable === 'لا'
      ? 'ابتدائي'
      : 'نهائي';

  const resolveOutcome = (r: JudgmentRecord): 'لصالحنا' | 'ضدنا' | 'قيد الدراسة' =>
    r.rulingOutcome === 'ضدنا'
      ? 'ضدنا'
      : r.rulingOutcome === 'قيد الدراسة'
        ? 'قيد الدراسة'
        : 'لصالحنا';

  const filteredRecords = records.filter((r) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      r.caseNumber?.toLowerCase().includes(q) ||
      r.judgmentNumber?.toLowerCase().includes(q) ||
      r.court?.toLowerCase().includes(q) ||
      r.plaintiff?.toLowerCase().includes(q) ||
      r.defendant?.toLowerCase().includes(q) ||
      r.assignedLawyer?.toLowerCase().includes(q) ||
      r.summary?.toLowerCase().includes(q);

    const degree = resolveDegree(r);
    const outcome = resolveOutcome(r);

    const matchesFilter =
      filterResult === 'all' ||
      (filterResult === 'نهائي' && degree === 'نهائي') ||
      (filterResult === 'ابتدائي' && degree === 'ابتدائي') ||
      (filterResult === 'لصالحنا' && outcome === 'لصالحنا') ||
      (filterResult === 'ضدنا' && outcome === 'ضدنا');

    return Boolean(matchesSearch && matchesFilter);
  });

  const finalCount = records.filter((r) => resolveDegree(r) === 'نهائي').length;
  const initialCount = records.filter((r) => resolveDegree(r) === 'ابتدائي').length;
  const wonCount = records.filter((r) => resolveOutcome(r) === 'لصالحنا').length;
  const againstCount = records.filter((r) => resolveOutcome(r) === 'ضدنا').length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" dir="rtl">
      {/* Header section */}
      <div className="fade-in-up flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-6 rounded-full bg-emerald-600" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              الأحكام والصكوك القضائية
            </h1>
          </div>
          <p className="text-muted-foreground text-sm mr-3">
            توثيق الصكوك القضائية وتصنيف درجتها (نهائي / ابتدائي) واتجاه الحكم (لصالحنا / ضدنا)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadRecords(true)}
            disabled={isLoading}
            className="gap-2 border-border"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>

          <Button
            onClick={handleOpenCreate}
            size="sm"
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            data-testid="button-add-judgment"
          >
            <Plus className="w-4 h-4" />
            إضافة حكم جديد
          </Button>
        </div>
      </div>

      {/* Explicit Error / Stale Data Banner */}
      {fetchError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <CloudOff className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold">تنبيه اتصال سجل الأحكام</p>
              <p className="text-muted-foreground">{fetchError.message}</p>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                {lastSyncedAt && (
                  <span>آخر مزامنة ناجحة: {new Date(lastSyncedAt).toLocaleString('ar-SA')}</span>
                )}
                {fetchError.refCode && (
                  <span className="font-mono">المرجع: {fetchError.refCode}</span>
                )}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadRecords(true)} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* Stats Quick Cards */}
      <div className="fade-in-up fade-in-up-delay-1 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-1">إجمالي الصكوك</p>
            <p className="text-2xl font-bold font-mono text-foreground">{records.length}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Gavel className="w-5 h-5 text-primary" />
          </div>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mb-1">
              أحكام لصالح الموكل
            </p>
            <p className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-300">
              {wonCount}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <ThumbsUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>

        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mb-1">
              أحكام ضد الموكل
            </p>
            <p className="text-2xl font-bold font-mono text-rose-700 dark:text-rose-300">
              {againstCount}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center">
            <ThumbsDown className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          </div>
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">
              نهائية / ابتدائية
            </p>
            <p className="text-xl font-bold font-mono text-blue-700 dark:text-blue-300">
              {finalCount} / {initialCount}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="fade-in-up fade-in-up-delay-1 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="البحث برقم القضية، رقم الصك، المحكمة، الأطراف، أو المحامي..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-9 h-10 bg-card border-border text-sm"
            data-testid="input-search-judgments"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-muted rounded-xl border border-border shrink-0">
          {(
            [
              { id: 'all', label: `الكل (${records.length})` },
              { id: 'لصالحنا', label: `لصالحنا (${wonCount})` },
              { id: 'ضدنا', label: `ضدنا (${againstCount})` },
              { id: 'نهائي', label: `نهائية (${finalCount})` },
              { id: 'ابتدائي', label: `ابتدائية (${initialCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterResult(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                filterResult === tab.id
                  ? 'bg-card text-foreground shadow-sm border border-border font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* List / Cards */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5">
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-full mb-1" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : filteredRecords.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 fade-in-up fade-in-up-delay-2">
          {filteredRecords.map((rec) => {
            const degree = resolveDegree(rec);
            const outcome = resolveOutcome(rec);
            const isFinal = degree === 'نهائي';
            const dayName = getArabicDayName({ sessionDateHijri: rec.judgmentDate });
            const isJustSaved = recentlySavedId === rec.id;

            return (
              <div
                key={rec.id}
                className={`rounded-2xl border bg-card p-5 relative group transition-all duration-200 hover:border-emerald-500/40 hover:shadow-lg flex flex-col justify-between ${
                  isJustSaved
                    ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                    : 'border-border'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-border/60">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {rec.caseNumber ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-mono">
                            قضية رقم: {rec.caseNumber}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground">
                            بدون رقم قضية
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Gavel className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <span className="text-[11px] text-muted-foreground block leading-tight font-medium">
                            رقم الصك
                          </span>
                          <span className="font-bold text-base font-mono text-foreground">
                            {rec.judgmentNumber}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${
                          outcome === 'لصالحنا'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                            : outcome === 'ضدنا'
                              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {outcome === 'لصالحنا' ? (
                          <ThumbsUp className="w-3 h-3" />
                        ) : (
                          <ThumbsDown className="w-3 h-3" />
                        )}
                        {outcome}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                          isFinal
                            ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25'
                            : 'bg-muted text-muted-foreground border-border'
                        }`}
                      >
                        {isFinal ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <FileText className="w-3 h-3" />
                        )}
                        {isFinal ? 'حكم نهائي' : 'حكم ابتدائي'}
                      </span>
                    </div>
                  </div>

                  {/* Structured Details List */}
                  <div className="space-y-2.5 text-xs">
                    {rec.court && (
                      <div className="flex items-center gap-2 text-muted-foreground bg-muted/30 p-2 rounded-lg border border-border/30">
                        <Scale className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span className="font-semibold text-foreground shrink-0">
                          المحكمة المختصة:
                        </span>
                        <span className="font-medium text-foreground truncate">{rec.court}</span>
                      </div>
                    )}

                    {(rec.plaintiff || rec.defendant) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="flex items-center gap-1.5 bg-background p-2 rounded-lg border border-border/50">
                          <User className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="text-[11px] font-semibold text-muted-foreground shrink-0">
                            المدعي:
                          </span>
                          <span className="font-medium text-foreground truncate">
                            {rec.plaintiff || '—'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 bg-background p-2 rounded-lg border border-border/50">
                          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-[11px] font-semibold text-muted-foreground shrink-0">
                            المدعى عليه:
                          </span>
                          <span className="font-medium text-foreground truncate">
                            {rec.defendant || '—'}
                          </span>
                        </div>
                      </div>
                    )}

                    {rec.assignedLawyer && (
                      <div className="flex items-center gap-2 text-muted-foreground bg-background p-2 rounded-lg border border-border/50">
                        <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="font-semibold text-foreground shrink-0">
                          المحامي المكلف:
                        </span>
                        <span className="font-medium text-foreground truncate">
                          {rec.assignedLawyer}
                        </span>
                      </div>
                    )}

                    {rec.judgmentDate && (
                      <div className="flex items-center justify-between gap-2 text-muted-foreground bg-background p-2 rounded-lg border border-border/50">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="font-semibold text-foreground">تاريخ الحكم:</span>
                          <span className="font-mono text-foreground font-bold" dir="ltr">
                            {rec.judgmentDate}
                          </span>
                        </div>
                        {dayName && (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium text-[11px] border border-emerald-500/20">
                            {dayName}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {rec.summary && (
                    <div className="mt-3 bg-muted/40 p-3 rounded-xl border border-border/60 text-xs text-muted-foreground leading-relaxed">
                      <span className="font-bold text-foreground mb-1 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-primary" />
                        منطوق وملخص الحكم:
                      </span>
                      <p className="text-foreground/90 whitespace-pre-wrap">{rec.summary}</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-border/40">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenEdit(rec)}
                    className="h-8 gap-1.5 text-xs text-foreground border-border hover:bg-muted"
                    data-testid={`button-edit-judgment-${rec.id}`}
                  >
                    <Edit3 className="w-3.5 h-3.5 text-primary" />
                    تعديل
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteTarget(rec)}
                    className="h-8 gap-1.5 text-xs text-destructive border-destructive/20 hover:bg-destructive/10 hover:border-destructive/30"
                    data-testid={`button-delete-judgment-${rec.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    حذف
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : !fetchError ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center fade-in-up">
          <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
            <Gavel className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">لا توجد أحكام مسجلة</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
            {searchQuery || filterResult !== 'all'
              ? 'لا توجد أحكام مطابقة لمعايير البحث والتصفية.'
              : 'قم بإضافة الأحكام والقرارات القضائية لمتابعة درجاتها ونتائجها هنا.'}
          </p>
          <Button
            onClick={handleOpenCreate}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="w-4 h-4" />
            إضافة حكم جديد
          </Button>
        </div>
      ) : null}

      {/* Create / Edit Dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => !isSaving && setIsOpen(open)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-600/10 flex items-center justify-center">
                <Gavel className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              {editingRecord ? 'تعديل بيانات صك الحكم' : 'إضافة حكم قضائي جديد'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="caseNumber" className="text-xs font-semibold">
                  رقم القضية
                </Label>
                <Input
                  id="caseNumber"
                  value={caseNumber}
                  onChange={(e) => setCaseNumber(normalizeArabicNumerals(e.target.value))}
                  placeholder="مثال: 44109283"
                  className="font-mono text-sm"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="judgmentNumber" className="text-xs font-semibold">
                  رقم الصك <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="judgmentNumber"
                  value={judgmentNumber}
                  onChange={(e) => setJudgmentNumber(normalizeArabicNumerals(e.target.value))}
                  placeholder="مثال: 443012948"
                  className="font-mono text-sm"
                  dir="ltr"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="court" className="text-xs font-semibold">
                المحكمة المختصة
              </Label>
              <Input
                id="court"
                value={court}
                onChange={(e) => setCourt(e.target.value)}
                placeholder="مثال: المحكمة العامة بالرياض"
                className="text-sm"
              />
            </div>

            <TeamMemberSelect
              id="assignedLawyer"
              label="المحامي المتابع للقضية"
              value={assignedLawyer}
              assigneeId={assigneeId}
              onChange={(name, memberId) => {
                setAssignedLawyer(name);
                setAssigneeId(memberId || null);
              }}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="plaintiff" className="text-xs font-semibold">
                  المدعي
                </Label>
                <Input
                  id="plaintiff"
                  value={plaintiff}
                  onChange={(e) => setPlaintiff(e.target.value)}
                  placeholder="اسم المدعي"
                  className="text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="defendant" className="text-xs font-semibold">
                  المدعى عليه
                </Label>
                <Input
                  id="defendant"
                  value={defendant}
                  onChange={(e) => setDefendant(e.target.value)}
                  placeholder="اسم المدعى عليه"
                  className="text-sm"
                />
              </div>
            </div>

            <DateField
              id="judgmentDate"
              label="تاريخ صدور الحكم"
              value={judgmentDate}
              onChange={setJudgmentDate}
              defaultCalendar="hijri"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">اتجاه الحكم (النتيجة للموكل)</Label>
                <Select
                  value={rulingOutcome}
                  onValueChange={(val) =>
                    setRulingOutcome(val as 'لصالحنا' | 'ضدنا' | 'قيد الدراسة')
                  }
                >
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="لصالحنا">لصالحنا (مكتسب للموكل)</SelectItem>
                    <SelectItem value="ضدنا">ضدنا (يستدعي الاعتراض/الاستئناف)</SelectItem>
                    <SelectItem value="قيد الدراسة">قيد الدراسة والتقييم</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">درجة الحكم القضائي</Label>
                <Select
                  value={judgmentType}
                  onValueChange={(val) => setJudgmentType(val as 'نهائي' | 'ابتدائي')}
                >
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="نهائي">حكم نهائي قطعي</SelectItem>
                    <SelectItem value="ابتدائي">حكم ابتدائي قابل للاعتراض</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="summary" className="text-xs font-semibold">
                منطوق وملخص الحكم
              </Label>
              <Textarea
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="منطوق الحكم والتفاصيل الأساسية للقرار ومهلة الاعتراض إن وجدت..."
                className="text-sm min-h-[90px] resize-none"
              />
            </div>

            <DialogFooter className="gap-2 flex-row-reverse pt-2">
              <Button
                type="submit"
                disabled={isSaving}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white flex-1"
                data-testid="button-save-judgment"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSaving ? 'جارٍ الحفظ...' : editingRecord ? 'تحديث صك الحكم' : 'حفظ واعتماد الحكم'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isSaving}
              >
                إلغاء
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف صك الحكم</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من نقل صك الحكم رقم{' '}
              <span className="font-mono font-semibold text-foreground">
                {deleteTarget?.judgmentNumber}
              </span>{' '}
              إلى سلة المحذوفات؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 flex-row-reverse">
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              data-testid="button-confirm-delete-judgment"
            >
              تأكيد الحذف
            </AlertDialogAction>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
