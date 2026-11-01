import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  UserCheck,
  UserPlus,
  Briefcase,
  Coins,
  Settings,
  Mail,
  Phone,
  CheckCircle2,
  XCircle,
  AlertCircle,
  History,
  Trash2,
  RotateCcw,
  Download,
  ShieldCheck,
  FileCheck2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

export type TeamRole = 'manager' | 'lawyer' | 'paralegal' | 'accountant';

export interface TeamMember {
  id: string;
  name: string;
  username: string;
  role: TeamRole;
  email?: string;
  phone?: string;
  assignedCasesCount?: number;
  status: 'active' | 'inactive';
  canAccessFinances: boolean;
  canEditCases: boolean;
  canManageSettings: boolean;
  createdAt: string;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorUsername: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
}

interface TrashItem {
  entityType: 'session' | 'poa' | 'task' | 'judgment' | 'case' | 'client';
  id: string | number;
  title: string;
  deletedAt: string;
}

const ROLE_LABELS: Record<TeamRole, { label: string; desc: string; badge: string }> = {
  manager: {
    label: 'مدير المكتب',
    desc: 'إدارة كاملة، تعيين القضايا، وإدارة صلاحيات الفريق والإعدادات',
    badge: 'bg-amber-500/10 text-amber-600 border-amber-300 dark:text-amber-400',
  },
  lawyer: {
    label: 'محامٍ ممارس',
    desc: 'حضور الجلسات، تقديم المذكرات، ومتابعة القضايا المسندة',
    badge: 'bg-primary/10 text-primary border-primary/30',
  },
  paralegal: {
    label: 'مساعد قانوني',
    desc: 'إدخال البيانات، متابعة المواعيد، وجدولة جلسات المحكمة',
    badge: 'bg-blue-500/10 text-blue-600 border-blue-300 dark:text-blue-400',
  },
  accountant: {
    label: 'محاسب مالي',
    desc: 'متابعة أتعاب القضايا، تحصيل الدفعات، والتقارير المالية فقط',
    badge: 'bg-emerald-500/10 text-emerald-600 border-emerald-300 dark:text-emerald-400',
  },
};

function isStrongPassword(pw: string): boolean {
  const t = pw.trim();
  return t.length >= 8 && /[A-Za-z\u0600-\u06FF]/.test(t) && /[\d٠-٩]/.test(t);
}

export default function TeamPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'members' | 'audit'>('members');
  const [isAddOpen, setIsAddOpen] = useState(false);

  // New member form state
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<TeamRole>('lawyer');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [canAccessFinances, setCanAccessFinances] = useState(false);
  const [canEditCases, setCanEditCases] = useState(true);
  const [canManageSettings, setCanManageSettings] = useState(false);

  // Backup verification result
  const [backupVerifyMsg, setBackupVerifyMsg] = useState<string | null>(null);
  const [exportingBackup, setExportingBackup] = useState(false);

  // Fetch team members
  const { data: members = [], isLoading, isError } = useQuery<TeamMember[]>({
    queryKey: ['/api/team'],
    queryFn: async () => {
      const res = await fetch('/api/team', { credentials: 'include' });
      if (!res.ok) throw new Error('فشل جلب أعضاء فريق العمل');
      return res.json();
    },
  });

  // Fetch office audit logs
  const { data: auditData, refetch: refetchAudit } = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ['/api/audit/logs'],
    enabled: activeTab === 'audit',
    queryFn: async () => {
      const res = await fetch('/api/audit/logs?limit=60', { credentials: 'include' });
      if (!res.ok) return { logs: [] };
      return res.json();
    },
  });

  // Fetch soft-deleted trash items
  const { data: trashData, refetch: refetchTrash } = useQuery<{ items: TrashItem[] }>({
    queryKey: ['/api/audit/trash'],
    enabled: activeTab === 'audit',
    queryFn: async () => {
      const res = await fetch('/api/audit/trash', { credentials: 'include' });
      if (!res.ok) return { items: [] };
      return res.json();
    },
  });

  // Create member mutation
  const createMutation = useMutation({
    mutationFn: async (newMember: Record<string, unknown>) => {
      const res = await fetch('/api/team', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMember),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'فشل إضافة عضو الفريق');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team'] });
      toast({
        title: 'تمت الإضافة بنجاح',
        description: 'تم تسجيل العضو الجديد وضبط صلاحياته في المكتب.',
      });
      setIsAddOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      toast({
        title: 'خطأ',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  // Update permission mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<TeamMember> }) => {
      const res = await fetch(`/api/team/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'فشل تحديث الصلاحية');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/team'] });
      toast({
        title: 'تم تحديث الصلاحية',
        description: 'تم حفظ إعدادات الصلاحية وإبطال الجلسات القديمة فورياً.',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'خطأ',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  // Restore soft-deleted record
  const restoreMutation = useMutation({
    mutationFn: async (item: { entityType: TrashItem['entityType']; id: string | number }) => {
      const res = await fetch('/api/audit/restore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'فشل استعادة السجل');
      }
      return res.json();
    },
    onSuccess: () => {
      refetchTrash();
      refetchAudit();
      queryClient.invalidateQueries();
      toast({ title: 'تمت الاستعادة بنجاح', description: 'عاد السجل إلى القسم المختص في المكتب.' });
    },
    onError: (err: any) => {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    },
  });

  const handleExportBackup = async () => {
    setExportingBackup(true);
    try {
      const res = await fetch('/api/audit/backup', { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'فشل تصدير النسخة الاحتياطية');
      }
      const snapshot = await res.json();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `office-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'تم تحميل النسخة الاحتياطية', description: 'تم تصدير جميع بيانات المكتب في ملف JSON موثق.' });
      refetchAudit();
    } catch (err: any) {
      toast({ title: 'خطأ في النسخ الاحتياطي', description: err.message, variant: 'destructive' });
    } finally {
      setExportingBackup(false);
    }
  };

  const handleVerifyBackupFile = async (file: File) => {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const res = await fetch('/api/audit/backup/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ملف النسخة الاحتياطية غير صالح');
      setBackupVerifyMsg(`${data.message} (تاريخ التصدير: ${String(data.exportedAt || '').slice(0, 10)})`);
      toast({ title: 'نسخة سليمة ومطابقة', description: data.message });
    } catch (err: any) {
      setBackupVerifyMsg(null);
      toast({ title: 'فشل فحص النسخة الاحتياطية', description: err.message, variant: 'destructive' });
    }
  };

  const resetForm = () => {
    setName('');
    setUsername('');
    setPassword('');
    setRole('lawyer');
    setEmail('');
    setPhone('');
    setCanAccessFinances(false);
    setCanEditCases(true);
    setCanManageSettings(false);
  };

  const handleRoleChangeInForm = (newRole: TeamRole) => {
    setRole(newRole);
    if (newRole === 'manager') {
      setCanAccessFinances(true);
      setCanEditCases(true);
      setCanManageSettings(true);
    } else if (newRole === 'accountant') {
      setCanAccessFinances(true);
      setCanEditCases(false);
      setCanManageSettings(false);
    } else {
      setCanAccessFinances(false);
      setCanEditCases(true);
      setCanManageSettings(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !username.trim() || !password.trim()) {
      toast({
        title: 'حقول مطلوبة',
        description: 'يرجى إدخال الاسم واسم المستخدم وكلمة المرور.',
        variant: 'destructive',
      });
      return;
    }

    if (!isStrongPassword(password)) {
      toast({
        title: 'سياسة كلمة المرور',
        description: 'كلمة المرور يجب أن تتكون من 8 خانات على الأقل وتحتوي على أحرف وأرقام معاً.',
        variant: 'destructive',
      });
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      username: username.trim().toLowerCase(),
      password: password.trim(),
      role,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      canAccessFinances,
      canEditCases,
      canManageSettings,
      status: 'active',
    });
  };

  // Stats
  const totalMembers = members.length;
  const lawyersCount = members.filter((m) => m.role === 'lawyer').length;
  const paralegalCount = members.filter((m) => m.role === 'paralegal').length;
  const accountantsCount = members.filter((m) => m.role === 'accountant').length;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            <UserCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
              إدارة المكتب والفريق والتدقيق
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              تحديد أدوار وصلاحيات أعضاء المكتب، مع سجل التدقيق واستعادة المحذوفات والنسخ الاحتياطي.
            </p>
          </div>
        </div>

        {/* Add Member Dialog */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
              data-testid="button-add-member-trigger"
            >
              <UserPlus className="w-4 h-4" />
              <span>إضافة عضو جديد</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-primary" />
                <span>إضافة عضو جديد لفريق المكتب</span>
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleCreate} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">الاسم الكامل *</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: أ. فيصل الدوسري"
                    className="text-xs"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">اسم المستخدم للدخول *</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="مثال: f.aldosari"
                    className="text-xs font-mono text-left"
                    dir="ltr"
                    minLength={3}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  كلمة المرور للدخول * (8 خانات على الأقل تشمل أحرفاً وأرقاماً)
                </Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="مثال: Lawyer2026"
                  className="text-xs font-mono text-left"
                  dir="ltr"
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">الدور الوظيفي في المكتب *</Label>
                <Select value={role} onValueChange={(val: TeamRole) => handleRoleChangeInForm(val)}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="manager">مدير المكتب (إشراف كامل وتوزيع القضايا)</SelectItem>
                    <SelectItem value="lawyer">محامٍ ممارس (حضور جلسات ومذكرات)</SelectItem>
                    <SelectItem value="paralegal">مساعد قانوني (إدخال بيانات ومتابعة مهام)</SelectItem>
                    <SelectItem value="accountant">محاسب مالي (أتعاب وتحصيل فقط)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">البريد الإلكتروني</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="lawyer@firm.sa"
                    className="text-xs font-mono text-left"
                    dir="ltr"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">رقم الجوال / الواتساب</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0501234567"
                    className="text-xs font-mono text-left"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Permissions switches */}
              <div className="p-3 rounded-xl bg-muted/40 border border-border/60 space-y-3">
                <span className="text-xs font-bold text-foreground block">
                  صلاحيات الوصول والعمليات:
                </span>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium cursor-pointer">الاطلاع على المالية والأتعاب</Label>
                    <p className="text-[10px] text-muted-foreground">مشاهدة المبالغ والعقود والدفعات</p>
                  </div>
                  <Switch
                    checked={canAccessFinances}
                    onCheckedChange={setCanAccessFinances}
                    disabled={role === 'manager'}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium cursor-pointer">تعديل وإضافة القضايا والجلسات</Label>
                    <p className="text-[10px] text-muted-foreground">صلاحية التحرير والحفظ والإجراءات</p>
                  </div>
                  <Switch
                    checked={canEditCases}
                    onCheckedChange={setCanEditCases}
                    disabled={role === 'manager'}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium cursor-pointer">إدارة إعدادات النظام وتوزيع القضايا</Label>
                    <p className="text-[10px] text-muted-foreground">صلاحيات إدارية متقدمة للمكتب</p>
                  </div>
                  <Switch
                    checked={canManageSettings}
                    onCheckedChange={setCanManageSettings}
                    disabled={role === 'manager'}
                  />
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddOpen(false)}
                  className="text-xs"
                >
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="text-xs bg-primary text-primary-foreground"
                >
                  {createMutation.isPending ? 'جاري الإضافة...' : 'حفظ بيانات العضو'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tabs: Team vs Audit & Backup */}
      <div className="flex items-center gap-2 border-b border-border pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('members')}
          className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-t-xl border-b-2 transition-all ${activeTab === 'members'
              ? 'border-primary text-primary bg-primary/5'
              : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
        >
          <Users className="w-4 h-4" />
          <span>أعضاء الفريق والصلاحيات ({totalMembers})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-t-xl border-b-2 transition-all ${activeTab === 'audit'
              ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-500/5'
              : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
        >
          <History className="w-4 h-4" />
          <span>سجل التدقيق والاسترجاع والنسخ الاحتياطي</span>
        </button>
      </div>

      {activeTab === 'members' ? (
        <>
          {/* Role Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="border-border/80 bg-card p-3">
              <span className="text-[11px] text-muted-foreground">إجمالي فريق العمل</span>
              <div className="text-xl font-bold font-mono text-foreground mt-0.5">{totalMembers}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">أعضاء نشطين بالمنظومة</p>
            </Card>

            <Card className="border-border/80 bg-card p-3">
              <span className="text-[11px] text-muted-foreground">المحامون الممارسون</span>
              <div className="text-xl font-bold font-mono text-primary mt-0.5">{lawyersCount}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">مرافعة ودفاع وتمثيل</p>
            </Card>

            <Card className="border-border/80 bg-card p-3">
              <span className="text-[11px] text-muted-foreground">المساعدون القانونيون</span>
              <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-0.5">
                {paralegalCount}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">متابعة إجرائية وجدولة</p>
            </Card>

            <Card className="border-border/80 bg-card p-3">
              <span className="text-[11px] text-muted-foreground">الشؤون المالية والمحاسبة</span>
              <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                {accountantsCount}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">تحصيل وعقود وفواتير</p>
            </Card>
          </div>

          {/* Team Members List */}
          {isLoading ? (
            <div className="py-16 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">جاري تحميل قائمة الفريق والصلاحيات...</p>
            </div>
          ) : isError ? (
            <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
              <p className="font-semibold text-sm">حدث خطأ أثناء تحميل سجلات الفريق</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {members.map((member) => {
                const roleInfo = ROLE_LABELS[member.role] || ROLE_LABELS.lawyer;
                const isManager = member.role === 'manager';

                return (
                  <Card
                    key={member.id}
                    className="border-border/80 bg-card hover:border-primary/40 transition-all shadow-sm flex flex-col justify-between overflow-hidden"
                  >
                    <div>
                      <div className="p-4 pb-3 bg-muted/20 border-b border-border/50 flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                            {member.name.slice(0, 2)}
                          </div>
                          <div>
                            <h3 className="font-bold text-sm text-foreground">{member.name}</h3>
                            <p className="text-xs font-mono text-muted-foreground">@{member.username}</p>
                          </div>
                        </div>

                        <Badge variant="outline" className={`text-xs ${roleInfo.badge}`}>
                          {roleInfo.label}
                        </Badge>
                      </div>

                      <div className="p-4 space-y-3 text-xs">
                        <p className="text-muted-foreground leading-relaxed text-[11px]">
                          {roleInfo.desc}
                        </p>

                        <div className="grid grid-cols-2 gap-2 text-muted-foreground pt-1">
                          {member.phone && (
                            <div className="flex items-center gap-1.5">
                              <Phone className="w-3.5 h-3.5 text-primary" />
                              <span className="font-mono" dir="ltr">
                                {member.phone}
                              </span>
                            </div>
                          )}
                          {member.email && (
                            <div className="flex items-center gap-1.5 truncate">
                              <Mail className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="font-mono truncate">{member.email}</span>
                            </div>
                          )}
                        </div>

                        <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-2.5">
                          <span className="text-[11px] font-bold text-foreground block">
                            صلاحيات المستخدم الحالية:
                          </span>

                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Coins className="w-3.5 h-3.5 text-emerald-500" />
                              <span>الاطلاع على الأتعاب والمالية:</span>
                            </span>
                            <Switch
                              checked={member.canAccessFinances}
                              disabled={isManager}
                              onCheckedChange={(checked) =>
                                updateMutation.mutate({
                                  id: member.id,
                                  updates: { canAccessFinances: checked },
                                })
                              }
                            />
                          </div>

                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Briefcase className="w-3.5 h-3.5 text-blue-500" />
                              <span>تعديل القضايا والجلسات:</span>
                            </span>
                            <Switch
                              checked={member.canEditCases}
                              disabled={isManager}
                              onCheckedChange={(checked) =>
                                updateMutation.mutate({
                                  id: member.id,
                                  updates: { canEditCases: checked },
                                })
                              }
                            />
                          </div>

                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Settings className="w-3.5 h-3.5 text-amber-500" />
                              <span>إدارة الإعدادات وتوزيع القضايا:</span>
                            </span>
                            <Switch
                              checked={member.canManageSettings}
                              disabled={isManager}
                              onCheckedChange={(checked) =>
                                updateMutation.mutate({
                                  id: member.id,
                                  updates: { canManageSettings: checked },
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-muted/15 border-t border-border flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        {member.status === 'active' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-500" />
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          الحالة: {member.status === 'active' ? 'نشط ومفعل' : 'معطل'}
                        </span>
                      </div>

                      {!isManager && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            updateMutation.mutate({
                              id: member.id,
                              updates: { status: member.status === 'active' ? 'inactive' : 'active' },
                            })
                          }
                        >
                          {member.status === 'active' ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-6">
          {/* Backup & Verification Card */}
          <Card className="p-5 bg-card border-border space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>النسخ الاحتياطي والتحقق من سلامة البيانات</span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  تصدير نسخة احتياطية كاملة (JSON) لكافة القضايا والجلسات والوكالات والمهام والأحكام والمالية، أو فحص ملف نسخة احتياطية.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleExportBackup}
                  disabled={exportingBackup}
                  className="gap-2 text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{exportingBackup ? 'جارٍ التصدير...' : 'تصدير نسخة احتياطية الآن'}</span>
                </Button>
                <label className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md border border-border bg-background hover:bg-accent text-xs font-medium cursor-pointer">
                  <FileCheck2 className="w-3.5 h-3.5 text-primary" />
                  <span>فحص ملف نسخة</span>
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleVerifyBackupFile(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
            {backupVerifyMsg && (
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                ✔ {backupVerifyMsg}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Soft-Deleted Trash & Restore */}
            <Card className="p-5 bg-card border-border space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-rose-500" />
                  <span>سلة المحذوفات القابلة للاسترجاع</span>
                </h3>
                <Badge variant="secondary" className="text-[10px]">
                  {trashData?.items?.length || 0}
                </Badge>
              </div>
              {!trashData?.items?.length ? (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  لا توجد سجلات محذوفة حالياً في هذا المكتب.
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pe-1">
                  {trashData.items.map((item) => (
                    <div
                      key={`${item.entityType}-${item.id}`}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-border bg-muted/20 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{item.title}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {String(item.deletedAt || '').slice(0, 16).replace('T', ' ')}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={restoreMutation.isPending}
                        onClick={() => restoreMutation.mutate({ entityType: item.entityType, id: item.id })}
                        className="h-7 text-xs gap-1 shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>استرجاع</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Office Audit Trail */}
            <Card className="p-5 bg-card border-border space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <History className="w-4 h-4 text-amber-500" />
                  <span>سجل العمليات والتعديلات (Audit Log)</span>
                </h3>
                <Badge variant="secondary" className="text-[10px]">
                  {auditData?.logs?.length || 0}
                </Badge>
              </div>
              {!auditData?.logs?.length ? (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  لا توجد عمليات مسجلة بعد.
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pe-1">
                  {auditData.logs.map((log) => (
                    <div
                      key={log.id}
                      className="p-2.5 rounded-xl border border-border bg-muted/20 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{log.summary}</span>
                        <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                          {log.action}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                        <span>بواسطة: {log.actorUsername || 'النظام'}</span>
                        <span>{String(log.timestamp || '').slice(0, 19).replace('T', ' ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
  );
}
