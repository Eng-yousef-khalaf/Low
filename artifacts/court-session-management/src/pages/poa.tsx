import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Plus,
  Trash2,
  Clock,
  User,
  FileKey,
  AlertTriangle,
  CheckCircle2,
  Search,
  Edit3,
  Sparkles,
  Loader2,
  RefreshCw,
  CloudOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import moment from 'moment-hijri';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Skeleton } from '@/components/ui/skeleton';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { DateField } from '@/components/date-field';
import { isDateBefore, normalizeArabicNumerals } from '@/lib/date-validation';
import {
  readUserScopedJson,
  writeUserScopedJson,
  readUserScopedString,
  writeUserScopedString,
} from '@/lib/user-storage';

export interface PowerOfAttorney {
  id: number | string;
  sheetRowId?: number;
  recordId?: string;
  clientName: string;
  poaNumber: string;
  issueDateHijri: string;
  expiryDateHijri: string;
  daysRemaining: number;
  notes?: string;
  createdAt: string;
  isPendingSync?: boolean;
}

export type HijriDateValidation =
  | { status: 'empty'; days: 0; message: string }
  | { status: 'invalid'; days: 0; message: string }
  | { status: 'valid'; days: number; message: string };

/**
 * Strictly parses and validates a Hijri or Gregorian date string (DD/MM/YYYY or YYYY/MM/DD).
 * Normalizes Eastern Arabic / Persian numerals first.
 */
export function parseAndValidateHijriDate(rawDateStr: string): HijriDateValidation {
  const cleaned = normalizeArabicNumerals(rawDateStr || '').replace(/[هـم]/g, '').trim();
  if (!cleaned) {
    return { status: 'empty', days: 0, message: 'أدخل تاريخ الانتهاء' };
  }
  const parts = cleaned.split(/[\/\.-]/);
  if (parts.length !== 3) {
    return { status: 'invalid', days: 0, message: 'تاريخ غير صالح' };
  }
  let day: number, month: number, year: number;
  if (parts[0].length === 4) {
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else if (parts[2].length === 4) {
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  } else {
    return { status: 'invalid', days: 0, message: 'تاريخ غير صالح' };
  }

  if (isNaN(day) || isNaN(month) || isNaN(year) || month < 1 || month > 12) {
    return { status: 'invalid', days: 0, message: 'تاريخ غير صالح' };
  }

  try {
    let targetMoment: ReturnType<typeof moment>;
    if (year >= 1300 && year <= 1550) {
      if (day < 1 || day > 30) return { status: 'invalid', days: 0, message: 'تاريخ غير صالح' };
      targetMoment = moment(`${year}/${month}/${day}`, 'iYYYY/iM/iD');
    } else if (year >= 1900 && year <= 2100) {
      const maxD = new Date(year, month, 0).getDate();
      if (day < 1 || day > maxD) return { status: 'invalid', days: 0, message: 'تاريخ غير صالح' };
      targetMoment = moment(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, 'YYYY-MM-DD');
    } else {
      return { status: 'invalid', days: 0, message: 'تاريخ غير صالح' };
    }

    if (!targetMoment.isValid()) {
      return { status: 'invalid', days: 0, message: 'تاريخ غير صالح' };
    }
    const days = targetMoment.startOf('day').diff(moment().startOf('day'), 'days');
    let message = '';
    if (days < 0) {
      message = `منتهية (منذ ${Math.abs(days)} يوم)`;
    } else if (days === 0) {
      message = 'تنتهي اليوم (0 يوم)';
    } else {
      message = `${days} يوم متبقٍ`;
    }
    return { status: 'valid', days, message };
  } catch {
    return { status: 'invalid', days: 0, message: 'تاريخ غير صالح' };
  }
}

function calculateDaysRemainingFromHijri(hijriDateStr: string): number {
  const result = parseAndValidateHijriDate(hijriDateStr);
  return result.status === 'valid' ? result.days : 0;
}

function refreshDays(records: PowerOfAttorney[]): PowerOfAttorney[] {
  return records.map((r) => ({
    ...r,
    daysRemaining: r.expiryDateHijri
      ? calculateDaysRemainingFromHijri(r.expiryDateHijri)
      : r.daysRemaining,
  }));
}

export default function PowerOfAttorneyPage() {
  const { toast } = useToast();
  const { data: currentUser } = useGetCurrentUser();
  const userIdentity = currentUser as any;

  const [records, setRecords] = useState<PowerOfAttorney[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [fetchError, setFetchError] = useState<{ message: string; refCode?: string } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<PowerOfAttorney | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PowerOfAttorney | null>(null);

  // Form State
  const [clientName, setClientName] = useState('');
  const [poaNumber, setPoaNumber] = useState('');
  const [issueDateHijri, setIssueDateHijri] = useState('');
  const [expiryDateHijri, setExpiryDateHijri] = useState('');
  const [expiryValidation, setExpiryValidation] = useState<HijriDateValidation>({
    status: 'empty',
    days: 0,
    message: 'أدخل تاريخ الانتهاء',
  });
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setExpiryValidation(parseAndValidateHijriDate(expiryDateHijri));
  }, [expiryDateHijri]);

  const dateOrderConflict = Boolean(
    issueDateHijri.trim() &&
      expiryDateHijri.trim() &&
      isDateBefore(expiryDateHijri, issueDateHijri),
  );

  // ── Data fetching & Pending-Sync Reconciliation ────────────────────────────

  const loadRecords = useCallback(
    async (isManualRefresh = false) => {
      if (!userIdentity) return;
      if (isManualRefresh) setIsLoading(true);

      let pendingList = readUserScopedJson<PowerOfAttorney[]>('poa_pending_sync', userIdentity, []);
      const cachedConfirmed = readUserScopedJson<PowerOfAttorney[]>('poa_confirmed', userIdentity, []);
      const cachedSyncedAt = readUserScopedString('poa_synced_at', userIdentity);
      if (cachedSyncedAt) setLastSyncedAt(cachedSyncedAt);

      try {
        // Attempt to flush any pending unsynced records first
        if (pendingList.length > 0) {
          const stillPending: PowerOfAttorney[] = [];
          for (const pendingItem of pendingList) {
            try {
              const syncRes = await fetch('/api/poa', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-idempotency-key': String(pendingItem.id),
                },
                body: JSON.stringify({
                  clientName: pendingItem.clientName,
                  poaNumber: pendingItem.poaNumber,
                  issueDateHijri: pendingItem.issueDateHijri,
                  expiryDateHijri: pendingItem.expiryDateHijri,
                  daysRemaining: pendingItem.daysRemaining,
                  notes: pendingItem.notes || '',
                }),
                credentials: 'include',
              });
              if (!syncRes.ok) {
                stillPending.push(pendingItem);
              }
            } catch {
              stillPending.push(pendingItem);
            }
          }
          pendingList = stillPending;
          writeUserScopedJson('poa_pending_sync', userIdentity, pendingList);
        }

        const url = isManualRefresh ? '/api/poa?refresh=true' : '/api/poa';
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          setFetchError({
            message:
              errBody.error ||
              'تعذر استرجاع الوكالات من الخادم حالياً. البيانات المعروضة أدناه (إن وجدت) هي آخر نسخة محفوظة.',
            refCode: errBody.referenceCode,
          });
          const fallbackCombined = [
            ...pendingList,
            ...cachedConfirmed.filter((c) => !pendingList.some((p) => p.poaNumber === c.poaNumber)),
          ];
          setRecords(refreshDays(fallbackCombined));
          setIsLoading(false);
          return;
        }

        const data: (PowerOfAttorney & { sheetRowId?: number })[] = await res.json();
        const syncedHeader = res.headers.get('X-Synced-At') || new Date().toISOString();

        const serverConfirmed: PowerOfAttorney[] = (Array.isArray(data) ? data : []).map((d) => ({
          ...d,
          id: d.id ?? d.sheetRowId ?? `poa-${d.poaNumber}`,
          sheetRowId: Number(d.sheetRowId ?? d.id),
          isPendingSync: false,
        }));

        // Never wipe pending items unless confirmed by server!
        const remainingPending = pendingList.filter(
          (p) => !serverConfirmed.some((s) => s.poaNumber === p.poaNumber),
        );
        writeUserScopedJson('poa_pending_sync', userIdentity, remainingPending);
        writeUserScopedJson('poa_confirmed', userIdentity, serverConfirmed);
        writeUserScopedString('poa_synced_at', userIdentity, syncedHeader);

        setLastSyncedAt(syncedHeader);
        setFetchError(null);
        setRecords(refreshDays([...remainingPending, ...serverConfirmed]));
      } catch {
        setFetchError({
          message: 'تعذر الاتصال بالخادم لاسترجاع الوكالات. يتم عرض السجلات المحفوظة لحسابك مؤقتاً.',
        });
        const fallbackCombined = [
          ...pendingList,
          ...cachedConfirmed.filter((c) => !pendingList.some((p) => p.poaNumber === c.poaNumber)),
        ];
        setRecords(refreshDays(fallbackCombined));
      } finally {
        setIsLoading(false);
      }
    },
    [userIdentity],
  );

  useEffect(() => {
    if (!userIdentity) return;
    const pendingList = readUserScopedJson<PowerOfAttorney[]>('poa_pending_sync', userIdentity, []);
    const confirmedList = readUserScopedJson<PowerOfAttorney[]>('poa_confirmed', userIdentity, []);
    const combined = [
      ...pendingList,
      ...confirmedList.filter((l) => !pendingList.some((p) => p.poaNumber === l.poaNumber)),
    ];
    if (combined.length > 0) {
      setRecords(refreshDays(combined));
      setIsLoading(false);
    }
    loadRecords();
  }, [loadRecords, userIdentity]);

  // ── Form helpers ──────────────────────────────────────────────────────────

  const resetForm = () => {
    setClientName('');
    setPoaNumber('');
    setIssueDateHijri('');
    setExpiryDateHijri('');
    setExpiryValidation({ status: 'empty', days: 0, message: 'أدخل تاريخ الانتهاء' });
    setNotes('');
    setEditingRecord(null);
  };

  const handleOpenModal = (record?: PowerOfAttorney) => {
    if (record) {
      setEditingRecord(record);
      setClientName(record.clientName);
      setPoaNumber(record.poaNumber);
      setIssueDateHijri(record.issueDateHijri);
      setExpiryDateHijri(record.expiryDateHijri);
      setExpiryValidation(parseAndValidateHijriDate(record.expiryDateHijri));
      setNotes(record.notes || '');
    } else {
      resetForm();
    }
    setIsOpen(true);
  };

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !poaNumber.trim()) {
      toast({
        title: 'تنبيه',
        description: 'يرجى تعبئة اسم العميل ورقم الوكالة.',
        variant: 'destructive',
      });
      return;
    }
    if (expiryDateHijri.trim()) {
      const val = parseAndValidateHijriDate(expiryDateHijri);
      if (val.status === 'invalid') {
        toast({
          title: 'تاريخ غير صالح',
          description: 'تاريخ الانتهاء غير صالح. يرجى إدخال تاريخ صحيح مثل (10/01/1448).',
          variant: 'destructive',
        });
        return;
      }
    }
    if (issueDateHijri.trim()) {
      const issueVal = parseAndValidateHijriDate(issueDateHijri);
      if (issueVal.status === 'invalid') {
        toast({
          title: 'تاريخ غير صالح',
          description: 'تاريخ الإصدار غير صالح. يرجى إدخال تاريخ صحيح مثل (10/01/1445).',
          variant: 'destructive',
        });
        return;
      }
    }

    if (dateOrderConflict) {
      toast({
        title: 'تضارب في التواريخ',
        description: 'تاريخ انتهاء الوكالة لا يمكن أن يكون قبل تاريخ الإصدار.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    const days = calculateDaysRemainingFromHijri(expiryDateHijri);
    const payload = {
      clientName: clientName.trim(),
      poaNumber: normalizeArabicNumerals(poaNumber.trim()),
      issueDateHijri: normalizeArabicNumerals(issueDateHijri.trim()),
      expiryDateHijri: normalizeArabicNumerals(expiryDateHijri.trim()),
      daysRemaining: days,
      notes: notes.trim(),
    };

    try {
      const targetRowId = editingRecord?.sheetRowId ?? (typeof editingRecord?.id === 'number' ? editingRecord.id : undefined);

      if (editingRecord && targetRowId && !editingRecord.isPendingSync) {
        const res = await fetch(`/api/poa/${targetRowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include',
        });
        const resJson = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            title: 'تعذر تحديث الوكالة',
            description:
              (resJson.error || 'فشل تحديث بيانات الوكالة.') +
              (resJson.referenceCode ? ` (المرجع: ${resJson.referenceCode})` : ''),
            variant: 'destructive',
          });
          setIsSaving(false);
          return;
        }
        toast({ title: 'تم التحديث بنجاح', description: 'تم تثبيت بيانات الوكالة المحدثة في سجل المكتب.' });
        setIsOpen(false);
        resetForm();
        await loadRecords(true);
      } else {
        const idempotencyKey = `poa-${payload.poaNumber}-${Date.now()}`;
        const res = await fetch('/api/poa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify(payload),
          credentials: 'include',
        });
        const resJson = await res.json().catch(() => ({}));

        if (!res.ok) {
          // If upstream Google Sheets is temporarily unavailable (503), queue safely in isolated pending queue
          if (res.status === 503 && userIdentity) {
            const localPending: PowerOfAttorney = {
              id: idempotencyKey,
              ...payload,
              createdAt: new Date().toISOString(),
              isPendingSync: true,
            };
            const currentPending = readUserScopedJson<PowerOfAttorney[]>(
              'poa_pending_sync',
              userIdentity,
              [],
            );
            const nextPending = [
              localPending,
              ...currentPending.filter((p) => p.poaNumber !== localPending.poaNumber),
            ];
            writeUserScopedJson('poa_pending_sync', userIdentity, nextPending);
            setRecords((prev) => [localPending, ...prev]);
            setIsOpen(false);
            resetForm();
            toast({
              title: 'تم الحفظ في قائمة انتظار المزامنة',
              description: 'تعذر الوصول للمصدر الخارجي مؤقتاً؛ تم تأمين الوكالة لحسابك وستُزامن تلقائياً فور عودة الاتصال.',
            });
            setIsSaving(false);
            return;
          }

          // Validation / Link Incomplete / Subscription errors keep the modal open with user input intact!
          toast({
            title: 'تعذر حفظ الوكالة',
            description:
              (resJson.error || 'يرجى التحقق من البيانات المدخلة أو حالة ربط المكتب.') +
              (resJson.referenceCode ? ` (المرجع: ${resJson.referenceCode})` : ''),
            variant: 'destructive',
          });
          setIsSaving(false);
          return;
        }

        toast({ title: 'تمت الإضافة بنجاح', description: 'تم تثبيت الوكالة وتأكيد حفظها في سجل المكتب.' });
        setIsOpen(false);
        resetForm();
        await loadRecords(true);
      }
    } catch {
      if (!editingRecord && userIdentity) {
        const localId = `pending-${Date.now()}`;
        const localPending: PowerOfAttorney = {
          id: localId,
          ...payload,
          createdAt: new Date().toISOString(),
          isPendingSync: true,
        };
        const currentPending = readUserScopedJson<PowerOfAttorney[]>(
          'poa_pending_sync',
          userIdentity,
          [],
        );
        writeUserScopedJson('poa_pending_sync', userIdentity, [localPending, ...currentPending]);
        setRecords((prev) => [localPending, ...prev]);
        setIsOpen(false);
        resetForm();
        toast({
          title: 'حُفظت بانتظار المزامنة',
          description: 'انقطع الاتصال بالشبكة؛ تم حفظ الوكالة محلياً ضمن حساب المكتب لحين عودة الاتصال.',
        });
      } else {
        toast({
          title: 'خطأ في الاتصال',
          description: 'تعذر الاتصال بالخادم لحفظ التعديلات. لم يتم مسح مدخلاتك.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    const record = deleteTarget;
    setDeleteTarget(null);
    if (!record) return;

    if (record.isPendingSync && userIdentity) {
      const pendingList = readUserScopedJson<PowerOfAttorney[]>('poa_pending_sync', userIdentity, []);
      writeUserScopedJson(
        'poa_pending_sync',
        userIdentity,
        pendingList.filter((r) => r.id !== record.id),
      );
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      toast({ title: 'تم الحذف', description: 'تم إزالة الوكالة غير المتزامنة.' });
      return;
    }

    const targetRowId = record.sheetRowId ?? record.id;
    try {
      const res = await fetch(`/api/poa/${targetRowId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'تعذر حذف الوكالة من الخادم.');
      }
      toast({ title: 'تم الحذف', description: 'تم نقل الوكالة إلى سلة المحذوفات بنجاح.' });
      await loadRecords(true);
    } catch (err: any) {
      toast({
        title: 'تعذر الحذف',
        description: err?.message || 'حدث خطأ أثناء حذف الوكالة.',
        variant: 'destructive',
      });
    }
  };

  const filteredRecords = records.filter(
    (r) =>
      r.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.poaNumber.includes(normalizeArabicNumerals(searchQuery)) ||
      (r.notes && r.notes.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  return (
    <div className="p-6 lg:p-8 space-y-6" dir="rtl">
      {/* Header */}
      <div className="fade-in-up flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-6 rounded-full bg-emerald-500" />
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 text-foreground">
              <ShieldCheck className="w-6 h-6 text-emerald-500" />
              إدارة الوكالات الشرعية
            </h1>
          </div>
          <p className="text-muted-foreground text-sm mr-3">
            متابعة وكالات موكلي المكتب وصلاحيتها بمعزل تام وآمن لكل مكتب
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => loadRecords(true)}
            title="تحديث ومزامنة"
            aria-label="تحديث الوكالات"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={() => handleOpenModal()}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all"
              >
                <Plus className="w-4 h-4" />
                إضافة وكالة جديدة
              </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[550px]" dir="rtl">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <FileKey className="w-5 h-5" />
                  {editingRecord ? 'تعديل بيانات الوكالة' : 'إدخال بيانات وكالة جديدة'}
                </DialogTitle>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4 py-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Client Name */}
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="poa-client-name" className="text-xs font-semibold flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>اسم العميل / الموكل</span> <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      id="poa-client-name"
                      placeholder="مثال: شركة الحلول القانونية / محمد أحمد"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      required
                    />
                  </div>

                  {/* POA Number */}
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="poa-number" className="text-xs font-semibold flex items-center gap-1">
                      <FileKey className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>رقم الوكالة</span> <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      id="poa-number"
                      placeholder="مثال: 44589210"
                      value={poaNumber}
                      onChange={(e) => setPoaNumber(normalizeArabicNumerals(e.target.value))}
                      className="font-mono text-left"
                      dir="ltr"
                      required
                    />
                  </div>

                  {/* Issue Date */}
                  <div>
                    <DateField
                      id="poa-issue-date"
                      label="تاريخ الإصدار"
                      value={issueDateHijri}
                      onChange={setIssueDateHijri}
                      defaultCalendar="hijri"
                    />
                  </div>

                  {/* Expiry Date */}
                  <div>
                    <DateField
                      id="poa-expiry-date"
                      label="تاريخ الانتهاء"
                      value={expiryDateHijri}
                      onChange={setExpiryDateHijri}
                      defaultCalendar="hijri"
                    />
                  </div>

                  {/* Expiry / Issue Date Conflict Warning */}
                  {dateOrderConflict && (
                    <div className="md:col-span-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 p-2.5 rounded-lg border border-rose-500/20 font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>تنبيه: تاريخ انتهاء الوكالة لا يمكن أن يكون قبل تاريخ الإصدار.</span>
                    </div>
                  )}

                  {/* Auto-calculated days */}
                  <div className="space-y-1.5 md:col-span-2 bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-semibold text-foreground">حالة صلاحية الوكالة:</span>
                    </div>
                    <span
                      className={`font-mono text-sm font-bold px-3 py-0.5 rounded-full ${
                        expiryValidation.status === 'invalid'
                          ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                          : expiryValidation.status === 'empty'
                            ? 'bg-muted text-muted-foreground'
                            : expiryValidation.days <= 0
                              ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                              : expiryValidation.days <= 30
                                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                                : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {expiryValidation.message}
                    </span>
                  </div>

                  {/* Notes */}
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="poa-notes" className="text-xs font-semibold">
                      ملاحظات وشروط الوكالة
                    </Label>
                    <Textarea
                      id="poa-notes"
                      placeholder="اكتب هنا صلاحيات الوكالة أو أية ملاحظات إضافية..."
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0 mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsOpen(false)}
                    disabled={isSaving}
                  >
                    إلغاء
                  </Button>
                  <Button
                    type="submit"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isSaving || expiryValidation.status === 'invalid' || dateOrderConflict}
                  >
                    {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {editingRecord ? 'تحديث الوكالة' : 'حفظ واعتماد الوكالة'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Explicit Sync Error / Stale Data Banner (Audit #12) */}
      {fetchError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <CloudOff className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold">تنبيه اتصال مصدر الوكالات</p>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadRecords(true)}
            className="gap-1.5 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="بحث باسم العميل، رقم الوكالة أو الملاحظات..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pr-9"
        />
      </div>

      {/* Loading Skeletons */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : filteredRecords.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRecords.map((record) => {
            const isWarning = record.daysRemaining <= 30 && record.daysRemaining > 0;
            const isExpired = record.daysRemaining <= 0;

            return (
              <div
                key={String(record.id)}
                className="rounded-xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-all space-y-3 relative overflow-hidden"
              >
                <div
                  className={`absolute top-0 right-0 left-0 h-1 ${
                    record.isPendingSync
                      ? 'bg-sky-500'
                      : isExpired
                        ? 'bg-rose-500'
                        : isWarning
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                  }`}
                />

                <div className="flex items-start justify-between gap-2 pt-1">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-base text-foreground line-clamp-1">
                        {record.clientName}
                      </h3>
                      {record.isPendingSync && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 shrink-0">
                          بانتظار المزامنة
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                      <FileKey className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{record.poaNumber}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenModal(record)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                      title="تعديل"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(record)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Days remaining */}
                <div className="flex items-center justify-between bg-muted/50 p-2.5 rounded-lg text-xs font-semibold">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                    المتبقي (آلي):
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-xs ${
                      isExpired
                        ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                        : isWarning
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    }`}
                  >
                    {isExpired ? (
                      <>
                        <AlertTriangle className="w-3 h-3" /> منتهية
                      </>
                    ) : isWarning ? (
                      <>
                        <Clock className="w-3 h-3" /> {record.daysRemaining} يوم (قريباً)
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3 h-3" /> {record.daysRemaining} يوم
                      </>
                    )}
                  </span>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
                  <div>
                    <span className="block text-[10px] text-muted-foreground/70">تاريخ الإصدار</span>
                    <span className="font-mono font-medium text-foreground">
                      {record.issueDateHijri || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-muted-foreground/70">تاريخ الانتهاء</span>
                    <span className="font-mono font-medium text-foreground">
                      {record.expiryDateHijri || '—'}
                    </span>
                  </div>
                </div>

                {record.notes && (
                  <p className="text-xs text-muted-foreground bg-muted/30 p-2 rounded-md line-clamp-2 border border-border/30">
                    {record.notes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : fetchError ? (
        <div className="rounded-xl border border-amber-500/30 bg-card p-12 text-center space-y-3">
          <CloudOff className="w-10 h-10 text-amber-500 mx-auto" />
          <h3 className="text-base font-bold text-foreground">تعذر استرجاع الوكالات حالياً</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {fetchError.message}
          </p>
          <Button variant="outline" onClick={() => loadRecords(true)} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            إعادة المحاولة
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 mx-auto mb-4 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">لا توجد وكالات مسجلة</h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-4">
            قم بإضافة وكالات العملاء لمتابعة صلاحيتها وتنبيهات انتهائها داخل سجل مكتبك المعزول.
          </p>
          <Button
            onClick={() => handleOpenModal()}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="w-4 h-4" /> إضافة أول وكالة
          </Button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent dir="rtl" className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-500">
              <Trash2 className="w-5 h-5" />
              تأكيد حذف الوكالة
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
              هل أنت متأكد من نقل وكالة{' '}
              <span className="font-bold text-foreground">{deleteTarget?.clientName}</span>
              {deleteTarget?.poaNumber ? (
                <>
                  {' '}
                  — رقم <span className="font-mono text-foreground">{deleteTarget.poaNumber}</span>
                </>
              ) : null}{' '}
              إلى سلة المحذوفات؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirmed}
              className="bg-rose-600 hover:bg-rose-700 text-white focus:ring-rose-600"
            >
              نعم، احذف الوكالة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
