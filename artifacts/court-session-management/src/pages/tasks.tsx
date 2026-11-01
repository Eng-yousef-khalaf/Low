import { useState, useEffect, useCallback } from 'react';
import moment from 'moment-hijri';
import {
  CheckSquare,
  Plus,
  Trash2,
  Calendar,
  User,
  AlertTriangle,
  Clock,
  Search,
  Edit3,
  Bell,
  ChevronDown,
  ChevronUp,
  Flag,
  FileText,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Timer,
  Loader2,
  RefreshCw,
  MessageCircle,
  CloudOff,
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

// ─── Types ────────────────────────────────────────────────────────────────────
type Priority = 'عاجلة' | 'عادية';
type TaskStatus = 'قيد التنفيذ' | 'مكتملة' | 'مؤجلة' | 'معلقة';

interface Task {
  id: number;
  title: string;
  assignee: string;
  assigneeId?: string | null;
  priority: Priority;
  dueDate: string;
  status: TaskStatus;
  notes: string;
  createdAt: string;
  reminderSent?: boolean;
}

/**
 * Parses Hijri (1448), DD/MM/YYYY, or ISO YYYY-MM-DD task due dates accurately into end-of-day timestamp.
 */
function parseTaskDueEndMs(rawDate: string | undefined | null): number | null {
  const cleaned = normalizeArabicNumerals(rawDate || '').replace(/[هـم]/g, '').trim();
  if (!cleaned) return null;

  const parts = cleaned.split(/[\/\-.]/);
  if (parts.length === 3) {
    let day: number, month: number, year: number;
    if (parts[0].length === 4) {
      year = Number(parts[0]);
      month = Number(parts[1]);
      day = Number(parts[2]);
    } else if (parts[2].length === 4) {
      day = Number(parts[0]);
      month = Number(parts[1]);
      year = Number(parts[2]);
    } else {
      return null;
    }

    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;

    if (year >= 1300 && year <= 1550) {
      const m = moment(`${year}/${month}/${day}`, 'iYYYY/iM/iD');
      if (!m.isValid()) return null;
      const d = m.toDate();
      d.setHours(23, 59, 59, 999);
      return d.getTime();
    }

    if (year >= 1900 && year <= 2100) {
      const d = new Date(year, month - 1, day, 23, 59, 59, 999);
      return isNaN(d.getTime()) ? null : d.getTime();
    }
  }

  const fallback = new Date(cleaned);
  if (isNaN(fallback.getTime())) return null;
  fallback.setHours(23, 59, 59, 999);
  return fallback.getTime();
}

function getRemainingDays(dueDate: string): number | null {
  const ms = parseTaskDueEndMs(dueDate);
  if (ms === null) return null;
  return Math.ceil((ms - Date.now()) / (1000 * 60 * 60 * 24));
}

function getRemainingHours(dueDate: string): number | null {
  const ms = parseTaskDueEndMs(dueDate);
  if (ms === null) return null;
  return (ms - Date.now()) / (1000 * 60 * 60);
}

function classifyTask(task: Task): 'current' | 'upcoming' | 'past' {
  if (task.status === 'مكتملة') return 'past';
  const days = getRemainingDays(task.dueDate);
  if (days === null) return 'current';
  if (days < 0) return 'past';
  if (days <= 7) return 'current';
  return 'upcoming';
}

function formatDate(dateStr: string): string {
  if (!dateStr) return 'غير محدد';
  return normalizeArabicNumerals(dateStr);
}

type StatusKey = TaskStatus;

const statusConfig: Record<
  StatusKey,
  { color: string; bg: string; icon: React.FC<{ className?: string }> }
> = {
  'قيد التنفيذ': { color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', icon: Timer },
  مكتملة: { color: '#22C55E', bg: 'rgba(34,197,94,0.12)', icon: CheckCircle2 },
  مؤجلة: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: PauseCircle },
  معلقة: { color: '#EF4444', bg: 'rgba(239,68,68,0.12)', icon: XCircle },
};

const priorityConfig: Record<Priority, { color: string; bg: string }> = {
  عاجلة: { color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  عادية: { color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
};

const emptyForm = (): Omit<Task, 'id' | 'createdAt'> => ({
  title: '',
  assignee: '',
  assigneeId: null,
  priority: 'عادية',
  dueDate: '',
  status: 'قيد التنفيذ',
  notes: '',
  reminderSent: false,
});

// ─── RemainingBadge ───────────────────────────────────────────────────────────
function RemainingBadge({ dueDate, status }: { dueDate: string; status: TaskStatus }) {
  if (status === 'مكتملة') {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: 'rgba(34,197,94,0.12)', color: '#22C55E' }}
      >
        مكتملة
      </span>
    );
  }
  const days = getRemainingDays(dueDate);
  const hours = getRemainingHours(dueDate);
  if (days === null || hours === null) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
        بدون موعد
      </span>
    );
  }
  if (days < 0) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}
      >
        متأخرة {Math.abs(days)} يوم
      </span>
    );
  }
  if (hours <= 24) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium animate-pulse"
        style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}
      >
        أقل من 24 ساعة!
      </span>
    );
  }
  if (days === 0) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}
      >
        اليوم
      </span>
    );
  }
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        background: days <= 3 ? 'rgba(245,158,11,0.12)' : 'rgba(107,114,128,0.12)',
        color: days <= 3 ? '#F59E0B' : '#9CA3AF',
      }}
    >
      {days} يوم متبقٍ
    </span>
  );
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────
interface TaskCardProps {
  task: Task;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onView: (t: Task) => void;
  onReminder: (t: Task) => void;
  onSendWhatsapp: (t: Task) => void;
  isSendingWhatsapp?: boolean;
}

function TaskCard({
  task,
  onEdit,
  onDelete,
  onView,
  onReminder,
  onSendWhatsapp,
  isSendingWhatsapp,
}: TaskCardProps) {
  const s = statusConfig[task.status] || statusConfig['قيد التنفيذ'];
  const p = priorityConfig[task.priority] || priorityConfig['عادية'];
  const SIcon = s.icon;
  const h = getRemainingHours(task.dueDate);
  const canRemind = h !== null && h > 0 && h <= 24 && task.status !== 'مكتملة';

  return (
    <div
      className="rounded-xl border border-border bg-card cursor-pointer transition-all duration-200 hover:shadow-md group"
      onClick={() => onView(task)}
    >
      <div
        className="h-1 rounded-t-xl"
        style={{
          background:
            task.priority === 'عاجلة'
              ? 'linear-gradient(90deg,#EF4444,#F97316)'
              : 'linear-gradient(90deg,#6B7280,#9CA3AF)',
        }}
      />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-semibold text-sm leading-snug text-foreground line-clamp-2 flex-1">
            {task.title}
          </h3>
          <div
            className="flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {canRemind && (
              <button
                type="button"
                title="إرسال تذكير"
                onClick={() => onReminder(task)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-500 hover:bg-amber-500/10"
              >
                <Bell className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              title="إرسال تذكير عبر الواتساب"
              disabled={isSendingWhatsapp}
              onClick={(e) => {
                e.stopPropagation();
                onSendWhatsapp(task);
              }}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200 hover:scale-110 disabled:opacity-50"
              style={{ color: '#25D366' }}
            >
              {isSendingWhatsapp ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MessageCircle className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              title="تعديل"
              onClick={() => onEdit(task)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="حذف"
              onClick={() => onDelete(task)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: p.bg, color: p.color }}
          >
            <Flag className="w-3 h-3" />
            {task.priority}
          </span>
          <span
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: s.bg, color: s.color }}
          >
            <SIcon className="w-3 h-3" />
            {task.status}
          </span>
          <RemainingBadge dueDate={task.dueDate} status={task.status} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {task.assignee || 'غير محدد'}
          </span>
          <span className="flex items-center gap-1 font-mono">
            <Calendar className="w-3 h-3" />
            {formatDate(task.dueDate)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────
interface SectionProps {
  title: string;
  count: number;
  color: string;
  icon: React.FC<{ className?: string; style?: React.CSSProperties }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, count, color, icon: Icon, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-6">
      <button
        type="button"
        className="flex items-center gap-2 mb-3 w-full text-right cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${color}22` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
        <span className="font-bold text-sm text-foreground flex-1">{title}</span>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ background: `${color}22`, color }}
        >
          {count}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4" style={{ color }} />
        ) : (
          <ChevronDown className="w-4 h-4" style={{ color }} />
        )}
      </button>
      {open && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{children}</div>}
    </div>
  );
}

// ─── TaskFormDialog ───────────────────────────────────────────────────────────
interface TaskFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (d: Omit<Task, 'id' | 'createdAt'>) => void;
  initial?: Task | null;
  isSaving?: boolean;
}

function TaskFormDialog({ open, onClose, onSave, initial, isSaving }: TaskFormDialogProps) {
  const [form, setForm] = useState(emptyForm());

  // Initialize form ONLY when dialog transitions to open or target task ID changes
  // so failed saves NEVER wipe the user's entered dueDate or fields! (Audit #17)
  useEffect(() => {
    if (open) {
      setForm(initial ? { ...initial } : emptyForm());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const remainingDays = form.dueDate ? getRemainingDays(form.dueDate) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isSaving && onClose()}>
      <DialogContent className="max-w-lg w-full" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-primary" />
            {initial ? 'تعديل المهمة القانونية' : 'إضافة مهمة قانونية جديدة'}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.title.trim()) return;
            onSave(form);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="tk-title">عنوان المهمة *</Label>
            <Input
              id="tk-title"
              placeholder="مثال: إعداد مذكرة الجواب الأولي في الدعوى..."
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <TeamMemberSelect
            id="tk-assignee"
            label="المحامي / العضو المكلف بالمهمة"
            value={form.assignee}
            assigneeId={form.assigneeId}
            onChange={(name, memberId) =>
              setForm((f) => ({ ...f, assignee: name, assigneeId: memberId || null }))
            }
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>الأولوية</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => setForm((f) => ({ ...f, priority: v as Priority }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="عاجلة">عاجلة</SelectItem>
                  <SelectItem value="عادية">عادية</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>الحالة</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as TaskStatus }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="قيد التنفيذ">قيد التنفيذ</SelectItem>
                  <SelectItem value="مكتملة">مكتملة</SelectItem>
                  <SelectItem value="مؤجلة">مؤجلة</SelectItem>
                  <SelectItem value="معلقة">معلقة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <DateField
              id="tk-due"
              label="تاريخ التسليم المستهدف"
              value={form.dueDate}
              onChange={(val) => setForm((f) => ({ ...f, dueDate: val }))}
              defaultCalendar="hijri"
            />
            {remainingDays !== null && (
              <div className="flex justify-end">
                <span
                  className="text-xs px-3 py-1 rounded-lg font-semibold"
                  style={{
                    background:
                      remainingDays < 0
                        ? 'rgba(239,68,68,0.12)'
                        : remainingDays <= 3
                          ? 'rgba(245,158,11,0.12)'
                          : 'rgba(34,197,94,0.12)',
                    color:
                      remainingDays < 0 ? '#EF4444' : remainingDays <= 3 ? '#F59E0B' : '#22C55E',
                  }}
                >
                  {remainingDays < 0
                    ? `متأخر ${Math.abs(remainingDays)} يوم`
                    : remainingDays === 0
                      ? 'موعد التسليم اليوم'
                      : `متبقي ${remainingDays} يوم`}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tk-notes">ملاحظات وتفاصيل التنفيذ</Label>
            <Textarea
              id="tk-notes"
              placeholder="أي ملاحظات إضافية أو متطلبات للمهمة..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
            <Button type="submit" disabled={!form.title.trim() || isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              {initial ? 'حفظ التعديلات' : 'إضافة المهمة'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── TaskDetailDialog ─────────────────────────────────────────────────────────
interface TaskDetailDialogProps {
  task: Task | null;
  onClose: () => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onReminder: (t: Task) => void;
  onSendWhatsapp: (t: Task) => void;
  isSendingWhatsapp?: boolean;
}

function TaskDetailDialog({
  task,
  onClose,
  onEdit,
  onDelete,
  onReminder,
  onSendWhatsapp,
  isSendingWhatsapp,
}: TaskDetailDialogProps) {
  if (!task) return null;
  const s = statusConfig[task.status] || statusConfig['قيد التنفيذ'];
  const p = priorityConfig[task.priority] || priorityConfig['عادية'];
  const SIcon = s.icon;
  const h = getRemainingHours(task.dueDate);
  const canRemind = h !== null && h > 0 && h <= 24 && task.status !== 'مكتملة';
  const days = getRemainingDays(task.dueDate);

  return (
    <Dialog open={!!task} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md w-full" dir="rtl">
        <div
          className="absolute top-0 left-0 right-0 h-1.5 rounded-t-lg"
          style={{
            background:
              task.priority === 'عاجلة'
                ? 'linear-gradient(90deg,#EF4444,#F97316)'
                : 'linear-gradient(90deg,#6B7280,#9CA3AF)',
          }}
        />
        <DialogHeader className="pt-2">
          <DialogTitle className="text-right text-base leading-snug">{task.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <div className="flex flex-wrap gap-2">
            <span
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: p.bg, color: p.color }}
            >
              <Flag className="w-3 h-3" />
              {task.priority}
            </span>
            <span
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: s.bg, color: s.color }}
            >
              <SIcon className="w-3 h-3" />
              {task.status}
            </span>
            <RemainingBadge dueDate={task.dueDate} status={task.status} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-3 bg-muted/60 border border-border/50">
              <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
                <User className="w-3.5 h-3.5" />
                <span className="text-xs">المكلف</span>
              </div>
              <p className="text-sm font-medium text-foreground">{task.assignee || '—'}</p>
            </div>
            <div className="rounded-lg p-3 bg-muted/60 border border-border/50">
              <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
                <Calendar className="w-3.5 h-3.5" />
                <span className="text-xs">تاريخ التسليم</span>
              </div>
              <p className="text-sm font-medium font-mono text-foreground">
                {formatDate(task.dueDate)}
              </p>
            </div>
            <div className="rounded-lg p-3 col-span-2 bg-muted/60 border border-border/50">
              <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs">الأيام المتبقية</span>
              </div>
              <p className="text-sm font-medium text-foreground">
                {days !== null
                  ? days < 0
                    ? `متأخرة ${Math.abs(days)} يوم`
                    : days === 0
                      ? 'اليوم هو آخر يوم'
                      : `${days} يوم متبقٍ`
                  : '—'}
              </p>
            </div>
          </div>
          {task.notes && (
            <div className="rounded-lg p-3 bg-muted/60 border border-border/50">
              <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
                <FileText className="w-3.5 h-3.5" />
                <span className="text-xs">ملاحظات</span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                {task.notes}
              </p>
            </div>
          )}
          {canRemind && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
              <p className="text-xs flex-1 text-amber-600 dark:text-amber-400">
                تبقى أقل من 24 ساعة على موعد هذه المهمة!
              </p>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 shrink-0"
                onClick={() => onReminder(task)}
              >
                <Bell className="w-3 h-3 ml-1" />
                تذكير
              </Button>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
          <Button
            size="sm"
            onClick={() => {
              onClose();
              onEdit(task);
            }}
          >
            <Edit3 className="w-3.5 h-3.5 ml-1" />
            تعديل
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              onClose();
              onDelete(task);
            }}
          >
            <Trash2 className="w-3.5 h-3.5 ml-1" />
            حذف
          </Button>
          <Button
            size="sm"
            onClick={() => onSendWhatsapp(task)}
            disabled={isSendingWhatsapp}
            className="inline-flex items-center gap-1.5 shrink-0 border-0"
            style={{
              background: 'linear-gradient(135deg,#25D366,#128C7E)',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(37,211,102,0.35)',
            }}
          >
            {isSendingWhatsapp ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <MessageCircle className="w-3.5 h-3.5" />
            )}
            تذكير واتساب
          </Button>
          <Button size="sm" variant="outline" onClick={onClose} className="mr-auto">
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const { toast } = useToast();
  const { data: currentUser } = useGetCurrentUser();
  const userIdentity = currentUser as any;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [fetchError, setFetchError] = useState<{ message: string; refCode?: string } | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [sendingWhatsappId, setSendingWhatsappId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | TaskStatus>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | Priority>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [viewTask, setViewTask] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  const loadTasks = useCallback(
    async (isManualRefresh = false) => {
      if (!userIdentity) return;
      if (isManualRefresh) setIsLoading(true);
      const cachedSynced = readUserScopedString('tasks_synced_at', userIdentity);
      if (cachedSynced) setLastSyncedAt(cachedSynced);

      try {
        const url = isManualRefresh ? '/api/tasks?refresh=true' : '/api/tasks';
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) {
          const data: Task[] = await res.json();
          const syncedHeader = res.headers.get('X-Synced-At') || new Date().toISOString();
          setTasks(Array.isArray(data) ? data : []);
          setFetchError(null);
          setLastSyncedAt(syncedHeader);
          writeUserScopedJson('tasks_confirmed', userIdentity, data);
          writeUserScopedString('tasks_synced_at', userIdentity, syncedHeader);
        } else {
          const errBody = await res.json().catch(() => ({}));
          setFetchError({
            message: errBody.error || 'تعذر جلب المهام من الخادم حالياً.',
            refCode: errBody.referenceCode,
          });
          const local = readUserScopedJson<Task[]>('tasks_confirmed', userIdentity, []);
          setTasks(local);
        }
      } catch {
        setFetchError({
          message: 'تعذر الاتصال بالخادم لجلب المهام. يتم عرض آخر نسخة محفوظة لحسابك.',
        });
        const local = readUserScopedJson<Task[]>('tasks_confirmed', userIdentity, []);
        setTasks(local);
      } finally {
        setIsLoading(false);
      }
    },
    [userIdentity],
  );

  useEffect(() => {
    if (userIdentity) {
      loadTasks();
    }
  }, [loadTasks, userIdentity]);

  const handleSave = async (data: Omit<Task, 'id' | 'createdAt'>) => {
    setIsSaving(true);
    try {
      const payload = {
        ...data,
        dueDate: normalizeArabicNumerals(data.dueDate || ''),
      };
      let res: Response;
      if (editingTask) {
        res = await fetch(`/api/tasks/${editingTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/tasks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': `task-${payload.title.slice(0, 24)}-${Date.now()}`,
          },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const refSuffix = errData.referenceCode ? ` (المرجع: ${errData.referenceCode})` : '';
        throw new Error((errData.error || 'فشل حفظ المهمة.') + refSuffix);
      }

      toast({
        title: 'تم الحفظ بنجاح',
        description: editingTask
          ? 'تم تحديث بيانات المهمة في سجل المكتب.'
          : 'تم إضافة المهمة الجديدة وحفظها بنجاح.',
      });

      // Close modal ONLY after confirmed server save! (Audit #16, #17)
      setFormOpen(false);
      setEditingTask(null);
      await loadTasks(true);
    } catch (err: any) {
      toast({
        title: 'خطأ في الحفظ',
        description: err.message || 'تعذر حفظ المهمة. جميع مدخلاتك محفوظة ويمكنك المحاولة مجدداً.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setFormOpen(true);
  };
  const handleDelete = (task: Task) => setDeleteTarget(task);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/tasks/${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'فشل حذف المهمة.');
      }
      toast({ title: 'تم الحذف', description: 'تم نقل المهمة إلى سلة المحذوفات بنجاح.' });
      setDeleteTarget(null);
      await loadTasks(true);
    } catch (err: any) {
      toast({
        title: 'خطأ في الحذف',
        description: err.message || 'تعذر حذف المهمة.',
        variant: 'destructive',
      });
    }
  };

  const handleReminder = (task: Task) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('تذكير مهمة قانونية', {
        body: `"${task.title}" تقترب من موعد التسليم!`,
      });
    }
    toast({ title: 'تم إرسال التذكير المحلي', description: `تذكير: "${task.title}"` });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, reminderSent: true } : t)));
  };

  const handleSendWhatsappReminder = async (task: Task) => {
    setSendingWhatsappId(task.id);
    try {
      const res = await fetch(`/api/tasks/${task.id}/send-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'فشل إرسال تذكير الواتساب');
      }
      toast({
        title: 'تم الإرسال بنجاح',
        description: data.message || 'تم إرسال تذكير المهمة عبر الواتساب بنجاح.',
      });
    } catch (err: any) {
      toast({
        title: 'خطأ في إرسال التذكير',
        description: err?.message || 'تعذر إرسال تذكير الواتساب.',
        variant: 'destructive',
      });
    } finally {
      setSendingWhatsappId(null);
    }
  };

  const filtered = tasks.filter((t) => {
    if (
      search &&
      !t.title.toLowerCase().includes(search.toLowerCase()) &&
      !t.assignee.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    return true;
  });

  const currentTasks = filtered.filter((t) => classifyTask(t) === 'current');
  const upcomingTasks = filtered.filter((t) => classifyTask(t) === 'upcoming');
  const pastTasks = filtered.filter((t) => classifyTask(t) === 'past');

  const cp = (task: Task) => ({
    task,
    onEdit: handleEdit,
    onDelete: handleDelete,
    onView: setViewTask,
    onReminder: handleReminder,
    onSendWhatsapp: handleSendWhatsappReminder,
    isSendingWhatsapp: sendingWhatsappId === task.id,
  });

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#B88A3B,#D4A855)' }}
          >
            <CheckSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">إدارة المهام القانونية</h1>
            <p className="text-xs text-muted-foreground">{tasks.length} مهمة في سجل المكتب</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadTasks(true)}
            disabled={isLoading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
          <Button
            onClick={() => {
              setEditingTask(null);
              setFormOpen(true);
            }}
            className="flex items-center gap-2"
            style={{
              background: 'linear-gradient(135deg,#B88A3B,#D4A855)',
              color: '#fff',
              border: 'none',
            }}
          >
            <Plus className="w-4 h-4" />
            إضافة مهمة
          </Button>
        </div>
      </div>

      {/* Explicit Error / Stale Data Banner */}
      {fetchError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <CloudOff className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold">تنبيه اتصال سجل المهام</p>
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
          <Button variant="outline" size="sm" onClick={() => loadTasks(true)} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث في المهام أو اسم المكلف..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <Select
          value={filterStatus}
          onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الحالات</SelectItem>
            <SelectItem value="قيد التنفيذ">قيد التنفيذ</SelectItem>
            <SelectItem value="مكتملة">مكتملة</SelectItem>
            <SelectItem value="مؤجلة">مؤجلة</SelectItem>
            <SelectItem value="معلقة">معلقة</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filterPriority}
          onValueChange={(v) => setFilterPriority(v as typeof filterPriority)}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="الأولوية" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الأولويات</SelectItem>
            <SelectItem value="عاجلة">عاجلة</SelectItem>
            <SelectItem value="عادية">عادية</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(
          [
            { label: 'قيد التنفيذ', color: '#3B82F6', s: 'قيد التنفيذ' },
            { label: 'مكتملة', color: '#22C55E', s: 'مكتملة' },
            { label: 'مؤجلة', color: '#F59E0B', s: 'مؤجلة' },
            { label: 'معلقة', color: '#EF4444', s: 'معلقة' },
          ] as { label: string; color: string; s: TaskStatus }[]
        ).map((item) => (
          <div key={item.label} className="rounded-xl p-4 border border-border bg-card">
            <div className="text-2xl font-bold font-mono" style={{ color: item.color }}>
              {tasks.filter((t) => t.status === item.s).length}
            </div>
            <div className="text-xs mt-0.5 text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Empty or Error State */}
      {!isLoading && tasks.length === 0 && !fetchError && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground rounded-xl border border-dashed border-border bg-card/50">
          <CheckSquare className="w-12 h-12 opacity-40" />
          <p className="text-base font-semibold text-foreground">لا توجد مهام مسجلة حالياً</p>
          <p className="text-xs">ابدأ بإضافة مهمة قانونية جديدة وتعيين المحامي المكلف بها</p>
        </div>
      )}

      {/* Task Sections */}
      {filtered.length > 0 && (
        <>
          {currentTasks.length > 0 && (
            <Section
              title="المهام الحالية"
              count={currentTasks.length}
              color="#3B82F6"
              icon={Timer}
              defaultOpen
            >
              {currentTasks.map((t) => (
                <TaskCard key={t.id} {...cp(t)} />
              ))}
            </Section>
          )}
          {upcomingTasks.length > 0 && (
            <Section
              title="المهام القادمة"
              count={upcomingTasks.length}
              color="#B88A3B"
              icon={Calendar}
              defaultOpen
            >
              {upcomingTasks.map((t) => (
                <TaskCard key={t.id} {...cp(t)} />
              ))}
            </Section>
          )}
          {pastTasks.length > 0 && (
            <Section
              title="المهام المنتهية والمكتملة"
              count={pastTasks.length}
              color="#6B7280"
              icon={CheckCircle2}
              defaultOpen={false}
            >
              {pastTasks.map((t) => (
                <TaskCard key={t.id} {...cp(t)} />
              ))}
            </Section>
          )}
        </>
      )}

      {/* Dialogs */}
      <TaskFormDialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingTask(null);
        }}
        onSave={handleSave}
        initial={editingTask}
        isSaving={isSaving}
      />
      <TaskDetailDialog
        task={viewTask}
        onClose={() => setViewTask(null)}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onReminder={handleReminder}
        onSendWhatsapp={handleSendWhatsappReminder}
        isSendingWhatsapp={viewTask ? sendingWhatsappId === viewTask.id : false}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف المهمة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من نقل المهمة "{deleteTarget?.title}" إلى سلة المحذوفات؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              حذف
            </AlertDialogAction>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
