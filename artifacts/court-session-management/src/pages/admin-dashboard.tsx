import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Users,
  UserPlus,
  Trash2,
  Key,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Database,
  Copy,
  Check,
  User,
  Edit2,
  LogOut,
  Save,
  Eye,
  EyeOff,
  Sheet as SheetIcon,
  FileCode,
  Sparkles,
  Pause,
  Play,
  Calendar,
  Clock,
  RotateCw,
  RotateCcw,
  Zap,
  Crown,
  AlertTriangle,
  Sun,
  Moon,
  History,
  Building2,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { useGetCurrentUser, useLogout } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/components/theme-provider';

export type OfficeRole = 'office_manager' | 'lawyer' | 'paralegal' | 'accountant';

export interface AppUser {
  id: string;
  username: string;
  email?: string | null;
  role: 'admin' | 'staff';
  office_id?: string;
  office_role?: OfficeRole;
  display_name?: string | null;
  whatsapp_number?: string | null;
  status?: 'active' | 'suspended';
  subscription_end_date?: string | null;
  subscription_notes?: string | null;
  plan_tier?: 'plus' | 'pro';
  billing_cycle?: 'monthly' | 'annual';
  ai_quota_limit?: number;
  ai_usage_count?: number;
  ai_quota_period?: string;
  ai_renewal_date?: string | null;
  google_service_account_json?: string | null;
  google_spreadsheet_id?: string | null;
  google_sheet_name?: string | null;
  has_google_service?: boolean;
  created_at?: string;
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorUsername: string;
  officeId?: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
}

const OFFICE_ROLE_LABELS: Record<OfficeRole, string> = {
  office_manager: 'مدير مكتب',
  lawyer: 'محامٍ ممارس',
  paralegal: 'مساعد قانوني',
  accountant: 'محاسب مالي',
};

export function validateAdminPasswordPolicy(pw: string): { valid: boolean; error?: string } {
  const trimmed = (pw || '').trim();
  if (trimmed.length < 8) {
    return { valid: false, error: 'كلمة المرور يجب أن تتكون من 8 خانات على الأقل.' };
  }
  const hasLetter = /[A-Za-z\u0600-\u06FF]/.test(trimmed);
  const hasDigit = /[\d٠-٩۰-۹]/.test(trimmed);
  if (!hasLetter || !hasDigit) {
    return { valid: false, error: 'كلمة المرور يجب أن تحتوي على أحرف وأرقام معاً.' };
  }
  return { valid: true };
}

export function getSubscriptionInfo(user: AppUser) {
  const isSuspended = user.status === 'suspended';
  if (isSuspended) {
    return {
      statusText: 'موقوف مؤقتاً',
      badgeColor: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
      daysLeft: null,
      isExpiringSoon: false,
      isExpired: false,
      isSuspended: true,
    };
  }

  if (!user.subscription_end_date) {
    return {
      statusText: 'اشتراك دائم / غير محدد',
      badgeColor: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      daysLeft: null,
      isExpiringSoon: false,
      isExpired: false,
      isSuspended: false,
    };
  }

  const end = new Date(user.subscription_end_date);
  const now = new Date();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffTime = endDay - nowDay;
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    return {
      statusText: 'منتهي الصلاحية',
      badgeColor: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
      daysLeft,
      isExpiringSoon: false,
      isExpired: true,
      isSuspended: false,
    };
  }

  if (daysLeft <= 3) {
    return {
      statusText:
        daysLeft === 0
          ? 'ينتهي اليوم'
          : `ينتهي خلال ${daysLeft} ${daysLeft === 1 ? 'يوم' : daysLeft === 2 ? 'يومين' : 'أيام'}`,
      badgeColor: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 font-bold',
      daysLeft,
      isExpiringSoon: true,
      isExpired: false,
      isSuspended: false,
    };
  }

  return {
    statusText: `نشط (${daysLeft} يوماً)`,
    badgeColor: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    daysLeft,
    isExpiringSoon: false,
    isExpired: false,
    isSuspended: false,
  };
}

interface UsersApiResponse {
  isSupabaseConfigured: boolean;
  users: AppUser[];
  error?: string;
}

export function normalizeDateForInput(val?: string | null): string {
  if (!val) return '';
  const str = String(val).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  } catch {}
  return '';
}

export function formatDateDisplay(val?: string | null): string {
  if (!val || !val.trim()) return 'اشتراك دائم';
  const normalized = normalizeDateForInput(val);
  return normalized || String(val);
}

export function generateSupabaseSqlScript(rawTableName: string): string {
  const cleanName = rawTableName.trim().replace(/[^a-zA-Z0-9_]/g, '') || 'app_users';
  return `-- أنشئ جدول المستخدمين في Supabase عبر SQL Editor (جدول: ${cleanName}):
create table if not exists public.${cleanName} (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  email text,
  password_hash text not null,
  role text default 'staff' check (role in ('admin', 'staff')),
  office_id text,
  office_role text default 'office_manager' check (office_role in ('office_manager', 'lawyer', 'paralegal', 'accountant')),
  permissions jsonb,
  display_name text,
  whatsapp_number text,
  status text default 'active' check (status in ('active', 'suspended')),
  subscription_end_date text,    -- YYYY-MM-DD
  subscription_notes text,
  plan_tier text default 'plus' check (plan_tier in ('plus', 'pro')),
  billing_cycle text default 'annual' check (billing_cycle in ('monthly', 'annual')),
  ai_quota_limit integer default 50,
  ai_usage_count integer default 0,
  ai_quota_period text,
  ai_renewal_date text,
  session_version integer default 1,
  google_service_account_json text,
  google_spreadsheet_id text,
  google_sheet_name text default 'Sessions',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists idx_${cleanName}_username on public.${cleanName} (username);
create index if not exists idx_${cleanName}_office_id on public.${cleanName} (office_id);
create index if not exists idx_${cleanName}_status on public.${cleanName} (status);
create index if not exists idx_${cleanName}_role on public.${cleanName} (role);

alter table public.${cleanName} add column if not exists office_id text;
alter table public.${cleanName} add column if not exists office_role text default 'office_manager';
alter table public.${cleanName} add column if not exists permissions jsonb;
alter table public.${cleanName} add column if not exists whatsapp_number text;
alter table public.${cleanName} add column if not exists ai_quota_period text;
alter table public.${cleanName} add column if not exists ai_renewal_date text;
alter table public.${cleanName} add column if not exists session_version integer default 1;`;
}

type SubDurationChoice = '1m' | '3m' | '6m' | '1y' | 'custom' | 'unlimited';

const DURATION_LABELS: Record<SubDurationChoice, string> = {
  '1m': 'شهر واحد (30 يوماً)',
  '3m': '3 أشهر (90 يوماً)',
  '6m': '6 أشهر (180 يوماً)',
  '1y': 'سنة كاملة (365 يوماً)',
  custom: 'تاريخ مخصص',
  unlimited: 'اشتراك دائم ومفتوح',
};

export default function AdminDashboardPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: currentUser } = useGetCurrentUser();
  const logoutMutation = useLogout();
  const { theme, toggleTheme } = useTheme();

  // Active Tab
  const [activeTab, setActiveTab] = useState<'users' | 'plans' | 'supabase' | 'audit'>('users');

  // Loading states
  const [loading, setLoading] = useState(true);
  const [isSupabaseConfigured, setIsSupabaseConfigured] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Modals & Drawers state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addStep, setAddStep] = useState<1 | 2 | 3>(1);
  const [isDetailsDrawerOpen, setIsDetailsDrawerOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);

  // Renewal Modal State
  const [renewDuration, setRenewDuration] = useState<'1m' | '3m' | '6m' | '1y' | 'custom'>('1y');
  const [customRenewDate, setCustomRenewDate] = useState('');

  // Handover Card State
  const [handoverData, setHandoverData] = useState<{
    username: string;
    displayName?: string;
    password?: string;
    loginUrl: string;
    subscriptionEndDate?: string | null;
    subscriptionDurationText?: string;
    planTier?: string;
    billingCycle?: string;
    aiQuota?: number;
  } | null>(null);
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState(false);
  const [copiedHandover, setCopiedHandover] = useState(false);

  // Helper to compute end date strictly by days
  const computeEndDate = (
    dur: SubDurationChoice,
    baseDate: Date = new Date(),
  ): string => {
    if (dur === 'unlimited') return '';
    const d = new Date(baseDate);
    if (dur === '1m') d.setDate(d.getDate() + 30);
    else if (dur === '3m') d.setDate(d.getDate() + 90);
    else if (dur === '6m') d.setDate(d.getDate() + 180);
    else if (dur === '1y') d.setDate(d.getDate() + 365);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Synchronized default: billing_cycle = 'annual' <-> newSubscriptionDuration = '1y' <-> computeEndDate('1y')
  const [newSubscriptionDuration, setNewSubscriptionDuration] = useState<SubDurationChoice>('1y');
  const [editSubDurationMode, setEditSubDurationMode] = useState<'date' | 'unlimited'>('date');

  const createInitialNewUser = () => ({
    username: '',
    display_name: '',
    email: '',
    whatsapp_number: '',
    password: '',
    role: 'staff' as 'admin' | 'staff',
    office_id: '',
    office_role: 'office_manager' as OfficeRole,
    plan_tier: 'plus' as 'plus' | 'pro',
    billing_cycle: 'annual' as 'monthly' | 'annual',
    ai_quota_limit: 50,
    subscription_end_date: computeEndDate('1y'),
    subscription_notes: '',
    google_service_account_json: '',
    google_spreadsheet_id: '',
    google_sheet_name: '',
  });

  const [newUser, setNewUser] = useState(createInitialNewUser);
  const [newPassword, setNewPassword] = useState('');

  const [editUserData, setEditUserData] = useState({
    display_name: '',
    email: '',
    whatsapp_number: '',
    role: 'staff' as 'admin' | 'staff',
    office_id: '',
    office_role: 'office_manager' as OfficeRole,
    status: 'active' as 'active' | 'suspended',
    plan_tier: 'plus' as 'plus' | 'pro',
    billing_cycle: 'annual' as 'monthly' | 'annual',
    ai_quota_limit: 50,
    ai_usage_count: 0,
    subscription_end_date: '',
    subscription_notes: '',
    google_service_account_json: '',
    google_spreadsheet_id: '',
    google_sheet_name: '',
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Supabase Settings form state
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [supabaseTableName, setSupabaseTableName] = useState('app_users');
  const [supabaseKeyIsSet, setSupabaseKeyIsSet] = useState(false);
  const [showSupabaseKey, setShowSupabaseKey] = useState(false);
  const [savingSupabase, setSavingSupabase] = useState(false);

  const openAddModalWithDefaults = (overrides?: Partial<ReturnType<typeof createInitialNewUser>>, dur: SubDurationChoice = '1y') => {
    const base = createInitialNewUser();
    const cycle = overrides?.billing_cycle || base.billing_cycle;
    const syncedDur: SubDurationChoice =
      overrides?.subscription_end_date !== undefined
        ? dur
        : cycle === 'monthly'
          ? '1m'
          : '1y';
    setNewSubscriptionDuration(syncedDur);
    setNewUser({
      ...base,
      ...overrides,
      subscription_end_date:
        overrides?.subscription_end_date !== undefined
          ? overrides.subscription_end_date
          : computeEndDate(syncedDur),
    });
    setAddStep(1);
    setIsAddOpen(true);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        throw new Error('غير مصرح لك بالوصول إلى لوحة الإدارة.');
      }
      const data: UsersApiResponse = await res.json();
      setIsSupabaseConfigured(data.isSupabaseConfigured);
      const list = data.users || [];
      setUsers(list);
      if (selectedUser) {
        const refreshed = list.find((item) => item.id === selectedUser.id);
        if (refreshed) setSelectedUser(refreshed);
      }
    } catch (err: any) {
      toast({
        title: 'خطأ',
        description: err.message || 'فشل جلب قائمة المستخدمين',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchSupabaseSettings = async () => {
    try {
      const res = await fetch('/api/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSupabaseUrl(data.supabaseUrl || '');
        setSupabaseTableName(data.supabaseTableName || 'app_users');
        setSupabaseKeyIsSet(Boolean(data.supabaseKeyIsSet));
      }
    } catch {
      // ignore
    }
  };

  const fetchPlatformAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const res = await fetch('/api/audit/logs?scope=platform&limit=100', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch {
      // ignore
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchSupabaseSettings();
  }, []);

  useEffect(() => {
    if (activeTab === 'audit') {
      fetchPlatformAuditLogs();
    }
  }, [activeTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAddOpen(false);
        setIsEditModalOpen(false);
        setIsRenewModalOpen(false);
        setIsPasswordModalOpen(false);
        setIsDeleteModalOpen(false);
        setIsHandoverModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleAdminLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        navigate('/admin/login', { replace: true });
      },
      onError: () => {
        toast({ title: 'خطأ', description: 'فشل تسجيل الخروج', variant: 'destructive' });
      },
    });
  };

  const handleCopySql = () => {
    const script = generateSupabaseSqlScript(supabaseTableName);
    navigator.clipboard.writeText(script);
    setCopiedSql(true);
    toast({
      title: 'تم النسخ',
      description: `تم نسخ سكربت SQL الخاص بجدول (${supabaseTableName || 'app_users'}) بنجاح.`,
    });
    setTimeout(() => setCopiedSql(false), 3000);
  };

  const handleSaveSupabaseSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSupabase(true);
    try {
      const payload: Record<string, string> = {
        supabaseUrl: supabaseUrl.trim(),
        supabaseTableName: supabaseTableName.trim() || 'app_users',
      };
      if (supabaseKey.trim()) {
        payload.supabaseKey = supabaseKey.trim();
      }

      const res = await fetch('/api/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'فشل حفظ إعدادات Supabase');
      }

      const updated = await res.json();
      setSupabaseKeyIsSet(Boolean(updated.supabaseKeyIsSet));
      setSupabaseKey('');

      toast({
        title: 'تم الحفظ بنجاح',
        description: 'تم تحديث بيانات الاتصال بـ Supabase وتثبيتها.',
      });

      await fetchUsers();
      await fetchSupabaseSettings();
    } catch (err: any) {
      toast({
        title: 'خطأ في الحفظ',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSavingSupabase(false);
    }
  };

  const validateAddStep1 = (): boolean => {
    if (!newUser.username.trim()) {
      toast({ title: 'تنبيه', description: 'يرجى إدخال اسم المستخدم.', variant: 'destructive' });
      return false;
    }
    const pwCheck = validateAdminPasswordPolicy(newUser.password);
    if (!pwCheck.valid) {
      toast({ title: 'سياسة كلمة المرور', description: pwCheck.error, variant: 'destructive' });
      return false;
    }
    return true;
  };

  const validateAddStep2 = (): boolean => {
    if (
      newUser.role === 'staff' &&
      newSubscriptionDuration !== 'unlimited' &&
      !newUser.subscription_end_date.trim()
    ) {
      toast({ title: 'تنبيه', description: 'يرجى تحديد تاريخ انتهاء الاشتراك.', variant: 'destructive' });
      return false;
    }
    return true;
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAddStep1() || !validateAddStep2()) return;

    if (newUser.google_service_account_json.trim()) {
      try {
        const parsed = JSON.parse(newUser.google_service_account_json.trim());
        if (!parsed.client_email || !parsed.private_key) {
          toast({
            title: 'خطأ في ملف Google JSON',
            description: 'الملف يجب أن يحتوي على client_email و private_key.',
            variant: 'destructive',
          });
          return;
        }
      } catch {
        toast({
          title: 'صيغة JSON غير صحيحة',
          description: 'تأكد من نسخ كود Google Service Account JSON بشكل سليم.',
          variant: 'destructive',
        });
        return;
      }
    }

    setActionLoading(true);
    try {
      const effectiveEndDate =
        newUser.role === 'staff' && newSubscriptionDuration !== 'unlimited'
          ? newUser.subscription_end_date || null
          : null;

      const payload = {
        ...newUser,
        username: newUser.username.trim(),
        office_id: newUser.office_id.trim() || undefined,
        whatsapp_number: newUser.whatsapp_number.trim() || undefined,
        status: 'active',
        subscription_end_date: effectiveEndDate,
      };

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل إنشاء المستخدم');
      }

      const savedPassword = newUser.password.trim();
      toast({
        title: 'تم التسجيل بنجاح',
        description: `تم إنشاء حساب (${data.username}) وتجهيز بطاقة التسليم.`,
      });
      setIsAddOpen(false);

      setHandoverData({
        username: data.username,
        displayName: newUser.display_name || data.username,
        password: savedPassword,
        loginUrl: `${window.location.origin}/login`,
        subscriptionEndDate: effectiveEndDate,
        subscriptionDurationText: DURATION_LABELS[newSubscriptionDuration] || 'نشط',
        planTier: newUser.plan_tier,
        billingCycle: newUser.billing_cycle,
        aiQuota: newUser.ai_quota_limit,
      });
      setIsHandoverModalOpen(true);
      setNewUser(createInitialNewUser());
      setNewSubscriptionDuration('1y');
      setAddStep(1);
      fetchUsers();
    } catch (err: any) {
      toast({ title: 'فشل العملية', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopyHandover = () => {
    if (!handoverData) return;
    const planText = handoverData.planTier === 'pro' ? 'برو (Pro)' : 'بلس (Plus)';
    const cycleText = handoverData.billingCycle === 'annual' ? 'سنوي (365 يوماً)' : 'شهري (30 يوماً)';
    const pwLine = handoverData.password
      ? handoverData.password
      : '[كلمة المرور المشفرة الحالية — تواصل مع المشرف عند الحاجة لإعادة التعيين]';
    const text = `السلام عليكم ورحمة الله وبركاته،
أهلاً بك أستاذ ${handoverData.displayName || handoverData.username}،
تم تفعيل اشتراكك وحسابك في منصة إدارة الجلسات والدعاوى القضائية:

🔗 رابط تسجيل الدخول:
${handoverData.loginUrl}

👤 اسم المستخدم:
${handoverData.username}

🔑 كلمة المرور:
${pwLine}

📦 باقة الاشتراك:
${planText} - دورة الفوترة: ${cycleText}

🤖 حصة الذكاء الاصطناعي الشهرية:
${handoverData.aiQuota || 50} تحليل رسائل شهرياً (تتجدد تلقائياً مطلع كل شهر)

📅 صلاحية الاشتراك:
${handoverData.subscriptionEndDate ? `تاريخ الانتهاء: ${formatDateDisplay(handoverData.subscriptionEndDate)} (${handoverData.subscriptionDurationText || 'نشط'})` : 'اشتراك دائم ومفتوح'}`;

    navigator.clipboard.writeText(text);
    setCopiedHandover(true);
    toast({ title: 'تم النسخ بنجاح', description: 'تم نسخ رسالة تسليم الحساب كاملة.' });
    setTimeout(() => setCopiedHandover(false), 2500);
  };

  const handleResetAiUsage = async (userId: string, username: string) => {
    if (!confirm(`هل أنت متأكد من إعادة تعيين (تصفير) استهلاك الذكاء الاصطناعي لـ (${username})؟`)) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/users/${userId}/reset-ai-usage`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تصفير استهلاك الذكاء الاصطناعي');
      }
      toast({
        title: 'تم تصفير الرصيد بنجاح',
        description: `تمت إعادة تعيين استهلاك الذكاء الاصطناعي لـ (${username}) إلى 0.`,
      });
      fetchUsers();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStatus = async (u: AppUser) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/users/${u.id}/toggle-status`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تحديث حالة الاشتراك');
      }
      toast({
        title: data.status === 'suspended' ? 'تم إيقاف الحساب مؤقتاً' : 'تم تفعيل الحساب بنجاح',
        description: data.message || `تم تحديث حالة اشتراك (${u.username}) وإبطال الجلسات القديمة.`,
      });
      fetchUsers();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const getRenewalPreviewInfo = () => {
    if (!selectedUser) {
      return {
        targetDate: '',
        isFromCurrentEnd: false,
        daysCount: 365,
        ruleDescription: 'يتم احتساب تاريخ الانتهاء الجديد تلقائياً.',
      };
    }
    const now = new Date();
    let baseDate = now;
    let isFromCurrentEnd = false;
    if (selectedUser.subscription_end_date) {
      const existing = new Date(selectedUser.subscription_end_date);
      if (existing.getTime() > now.getTime()) {
        baseDate = existing;
        isFromCurrentEnd = true;
      }
    }

    if (renewDuration === 'custom') {
      return {
        targetDate: customRenewDate || '',
        isFromCurrentEnd: false,
        daysCount: 0,
        ruleDescription: 'سيتم اعتماد التاريخ المخصص المحدد أعلاه مباشرة.',
      };
    }

    const daysMap: Record<string, number> = { '1m': 30, '3m': 90, '6m': 180, '1y': 365 };
    const daysCount = daysMap[renewDuration] || 365;
    const targetDate = computeEndDate(renewDuration, baseDate);
    const ruleDescription = isFromCurrentEnd
      ? `تمديد فوق تاريخ الانتهاء الساري حالياً بإضافة ${daysCount} يوماً كاملة دون ضياع الأيام المتبقية.`
      : `احتساب ${daysCount} يوماً بدءاً من تاريخ اليوم لأن الاشتراك السابق منتهٍ أو غير محدد.`;
    return { targetDate, isFromCurrentEnd, daysCount, ruleDescription };
  };

  const handleRenewSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    const preview = getRenewalPreviewInfo();
    const targetEndDate = preview.targetDate;
    if (!targetEndDate) {
      toast({ title: 'تنبيه', description: 'يرجى تحديد تاريخ انتهاء مخصص.', variant: 'destructive' });
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          subscription_end_date: targetEndDate,
          billing_cycle: renewDuration === '1y' ? 'annual' : renewDuration === '1m' ? 'monthly' : selectedUser.billing_cycle,
          status: 'active',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تجديد الاشتراك');
      }

      toast({
        title: 'تم تجديد الاشتراك بنجاح',
        description: `تم تمديد اشتراك (${selectedUser.username}) حتى ${targetEndDate}.`,
      });
      setIsRenewModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    const pwCheck = validateAdminPasswordPolicy(newPassword);
    if (!pwCheck.valid) {
      toast({ title: 'سياسة كلمة المرور', description: pwCheck.error, variant: 'destructive' });
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: newPassword.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تحديث كلمة المرور');
      }

      toast({
        title: 'تم التحديث',
        description: `تم تغيير كلمة المرور للمستخدم (${selectedUser.username}) وإبطال الجلسات السابقة.`,
      });
      setIsPasswordModalOpen(false);
      setNewPassword('');
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const openEditModalForUser = (u: AppUser) => {
    setSelectedUser(u);
    const hasEndDate = Boolean(u.subscription_end_date && u.subscription_end_date.trim());
    setEditSubDurationMode(hasEndDate ? 'date' : 'unlimited');
    setEditUserData({
      display_name: u.display_name || '',
      email: u.email || '',
      whatsapp_number: u.whatsapp_number || '',
      role: u.role,
      office_id: u.office_id || '',
      office_role: u.office_role || 'office_manager',
      status: u.status || 'active',
      plan_tier: u.plan_tier || 'plus',
      billing_cycle: u.billing_cycle || 'annual',
      ai_quota_limit: u.ai_quota_limit ?? 50,
      ai_usage_count: u.ai_usage_count || 0,
      subscription_end_date: normalizeDateForInput(u.subscription_end_date),
      subscription_notes: u.subscription_notes || '',
      google_service_account_json: '',
      google_spreadsheet_id: u.google_spreadsheet_id || '',
      google_sheet_name: u.google_sheet_name || '',
    });
    setIsEditModalOpen(true);
  };

  const activeAdminCount = users.filter((u) => u.role === 'admin' && u.status !== 'suspended').length;

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    if (selectedUser.role === 'admin' && editUserData.role === 'staff' && activeAdminCount <= 1) {
      toast({
        title: 'إجراء غير مسموح',
        description: 'لا يمكن تحويل المشرف الوحيد النشط إلى محامٍ. يجب تعيين مشرف آخر أولاً.',
        variant: 'destructive',
      });
      return;
    }

    if (editUserData.role === 'staff' && editSubDurationMode === 'date') {
      if (!editUserData.subscription_end_date?.trim()) {
        toast({
          title: 'تنبيه',
          description: 'يرجى إدخال تاريخ انتهاء الاشتراك أو اختيار اشتراك دائم ومفتوح.',
          variant: 'destructive',
        });
        return;
      }
    }

    if (editUserData.google_service_account_json.trim()) {
      try {
        const parsed = JSON.parse(editUserData.google_service_account_json.trim());
        if (!parsed.client_email || !parsed.private_key) {
          toast({
            title: 'خطأ في ملف Google JSON',
            description: 'الملف يجب أن يحتوي على client_email و private_key.',
            variant: 'destructive',
          });
          return;
        }
      } catch {
        toast({
          title: 'صيغة JSON غير صحيحة',
          description: 'تأكد من نسخ كود Google Service Account JSON بشكل سليم.',
          variant: 'destructive',
        });
        return;
      }
    }

    const payload = {
      ...editUserData,
      office_id: editUserData.office_id.trim() || undefined,
      whatsapp_number: editUserData.whatsapp_number.trim() || undefined,
      subscription_end_date:
        editUserData.role === 'admin'
          ? null
          : editSubDurationMode === 'unlimited'
            ? null
            : editUserData.subscription_end_date,
    };

    setActionLoading(true);
    try {
      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تعديل بيانات المستخدم');
      }

      toast({ title: 'تم الحفظ', description: 'تم تحديث بيانات الحساب وصلاحياته بنجاح.' });
      setIsEditModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'فشل حذف المستخدم');
      }

      toast({ title: 'تم الحذف', description: `تم حذف المستخدم (${selectedUser.username}) وإبطال جلساته.` });
      setIsDeleteModalOpen(false);
      setIsDetailsDrawerOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      (u.display_name && u.display_name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.office_id && u.office_id.toLowerCase().includes(q)) ||
      (u.google_spreadsheet_id && u.google_spreadsheet_id.toLowerCase().includes(q))
    );
  });

  const staffLawyers = users.filter((u) => u.role === 'staff');
  const activeStaffCount = staffLawyers.filter((u) => {
    const info = getSubscriptionInfo(u);
    return !info.isSuspended && !info.isExpired;
  }).length;
  const expiringUsersList = staffLawyers.filter((u) => {
    const info = getSubscriptionInfo(u);
    return info.isExpiringSoon || info.isExpired;
  });
  const expiringStaffCount = expiringUsersList.length;
  const suspendedStaffCount = staffLawyers.filter((u) => u.status === 'suspended').length;

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {/* Top Navigation Bar for Admin Portal */}
      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md shrink-0"
              style={{ background: 'linear-gradient(135deg, #B88A3B 0%, #8c6422 100%)' }}
            >
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-sm sm:text-base tracking-tight text-foreground">
                  بوابة المشرف العام للمنصة
                </h1>
                <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px] hidden sm:inline-flex">
                  Platform Admin
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                المشرف الحالي: <strong className="text-foreground">{currentUser?.username || '—'}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleTheme}
              aria-label="تبديل المظهر الفاتح والداكن"
              data-testid="button-admin-theme-toggle"
              className="gap-1.5 text-xs h-9"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">الوضع الفاتح</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden sm:inline">الوضع الداكن</span>
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleAdminLogout}
              disabled={logoutMutation.isPending}
              className="gap-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 font-bold h-9"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>تسجيل الخروج</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-emerald-500/30 bg-card p-5 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
              <span className="text-xs font-bold">مكاتب ومحامون نشطون</span>
              <Users className="w-4 h-4" />
            </div>
            <p className="text-3xl font-extrabold text-foreground">
              {activeStaffCount}{' '}
              <span className="text-sm font-normal text-muted-foreground">/ {staffLawyers.length}</span>
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
              اشتراكات سارية وتعمل حالياً
            </p>
          </div>

          <div
            className={`rounded-2xl border bg-card p-5 shadow-xs space-y-2 transition-all ${
              expiringStaffCount > 0
                ? 'border-amber-500/50 ring-1 ring-amber-500/25'
                : 'border-border'
            }`}
          >
            <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
              <span className="text-xs font-bold">تنتهي قريباً أو منتهية</span>
              <AlertCircle className="w-4 h-4" />
            </div>
            <p className="text-3xl font-extrabold text-foreground">{expiringStaffCount}</p>
            <p className="text-[11px] text-muted-foreground font-medium">خلال 3 أيام أو أقل</p>
          </div>

          <div
            className={`rounded-2xl border bg-card p-5 shadow-xs space-y-2 ${
              suspendedStaffCount > 0 ? 'border-rose-500/40' : 'border-border'
            }`}
          >
            <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
              <span className="text-xs font-bold">اشتراكات موقوفة مؤقتاً</span>
              <Pause className="w-4 h-4" />
            </div>
            <p className="text-3xl font-extrabold text-foreground">{suspendedStaffCount}</p>
            <p className="text-[11px] text-muted-foreground font-medium">موقوفة من الوصول</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-bold">إجمالي الحسابات المسجلة</span>
              <CheckCircle2 className="w-4 h-4 text-primary" />
            </div>
            <p className="text-3xl font-extrabold text-foreground">{users.length}</p>
            <p className="text-[11px] text-muted-foreground font-medium">مشرفو منصة ومكاتب محاماة</p>
          </div>
        </div>

        {/* Expiring Banner */}
        {expiringUsersList.length > 0 && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 shadow-xs space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
                  <span>تنبيه اشتراكات قريبة من الانتهاء أو منتهية</span>
                  <Badge className="bg-amber-600 text-white font-bold text-[10px] px-2 py-0.5">
                    {expiringUsersList.length}
                  </Badge>
                </h3>
                <p className="text-xs text-muted-foreground">
                  يمكنك تجديد وتفعيل الاشتراك مباشرة بضغطة واحدة:
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {expiringUsersList.map((u) => {
                const info = getSubscriptionInfo(u);
                return (
                  <div
                    key={u.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card border border-amber-500/35 text-xs"
                  >
                    <User className="w-3.5 h-3.5 text-amber-500" />
                    <span className="font-bold text-foreground">{u.display_name || u.username}</span>
                    <span
                      className={`text-[11px] font-mono font-bold ${
                        info.isExpired
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      ({info.statusText})
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedUser(u);
                        setRenewDuration(u.billing_cycle === 'monthly' ? '1m' : '1y');
                        setCustomRenewDate('');
                        setIsRenewModalOpen(true);
                      }}
                      className="h-6 px-2 text-[10px] gap-1 font-bold"
                    >
                      <RotateCw className="w-2.5 h-2.5" />
                      <span>تجديد</span>
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-1">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'users'
                ? 'border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-500/5'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>حسابات المكاتب والمشتركين</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {users.length}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('supabase')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'supabase'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400 bg-sky-500/5'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>قاعدة البيانات (Supabase)</span>
            <span
              className={`w-2 h-2 rounded-full ${
                isSupabaseConfigured ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('plans')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'plans'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>باقات الاشتراك (Plus & Pro)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'audit'
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <History className="w-4 h-4" />
            <span>سجل التدقيق العام</span>
          </button>
        </div>

        {/* Tab 1: Streamlined Users Table (5 clean columns — no horizontal scroll clutter) */}
        {activeTab === 'users' && (
          <div className="space-y-4 fade-in-up">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 text-foreground">
                  <Users className="w-5 h-5 text-primary" />
                  إدارة المكاتب وحسابات المشتركين
                </h2>
                <p className="text-xs text-muted-foreground">
                  جدول مختصر وواضح؛ اضغط «تفاصيل وتحكم» لعرض لوحة التحكم الكاملة بالحساب والربط والاشتراك.
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchUsers}
                  disabled={loading}
                  className="gap-2 text-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>تحديث</span>
                </Button>

                <Button
                  size="sm"
                  onClick={() => openAddModalWithDefaults()}
                  data-testid="button-admin-add-user"
                  className="gap-2 text-xs text-white"
                  style={{ background: 'linear-gradient(135deg, #B88A3B 0%, #966c25 100%)' }}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>إضافة مستخدم جديد</span>
                </Button>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative max-w-md">
              <Search className="w-4 h-4 absolute start-3 inset-y-0 my-auto text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو اسم المستخدم أو معرّف المكتب..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-9 text-sm h-9 bg-card"
              />
            </div>

            {/* Compact Users Table */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs sm:text-sm">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                    <tr>
                      <th className="py-3 px-4 text-start">الحساب والمكتب</th>
                      <th className="py-3 px-3 text-start">النطاق والدور</th>
                      <th className="py-3 px-3 text-start">الاشتراك والصلاحية</th>
                      <th className="py-3 px-3 text-start hidden md:table-cell">الحصة والربط السحابي</th>
                      <th className="py-3 px-4 text-end">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                            <span className="text-xs">جارٍ جلب الحسابات...</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <Users className="w-8 h-8 opacity-30" />
                            <p className="text-sm font-medium">لا توجد حسابات مطابقة</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const isCurrent = currentUser?.username === u.username;
                        const subInfo = getSubscriptionInfo(u);
                        const officeRoleLabel =
                          u.role === 'admin'
                            ? 'مشرف المنصة العام'
                            : OFFICE_ROLE_LABELS[u.office_role || 'office_manager'] || 'مدير مكتب';

                        return (
                          <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                            {/* Column 1: Account & Office */}
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                                  {u.username.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-foreground truncate">
                                      {u.display_name || u.username}
                                    </span>
                                    {isCurrent && (
                                      <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/30">
                                        أنت
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                                    <span>@{u.username}</span>
                                    {u.office_id && u.role !== 'admin' && (
                                      <span className="truncate max-w-[120px]" title={u.office_id}>
                                        · {u.office_id}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Column 2: Platform vs Office Role */}
                            <td className="py-3 px-3">
                              {u.role === 'admin' ? (
                                <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 gap-1 text-xs">
                                  <ShieldCheck className="w-3 h-3" />
                                  <span>مشرف المنصة</span>
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="gap-1 text-xs">
                                  <Building2 className="w-3 h-3 text-primary" />
                                  <span>{officeRoleLabel}</span>
                                </Badge>
                              )}
                            </td>

                            {/* Column 3: Subscription & Clean Date */}
                            <td className="py-3 px-3">
                              {u.role === 'admin' ? (
                                <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                                  وصول إداري دائم
                                </Badge>
                              ) : (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <Badge className={`${subInfo.badgeColor} text-[11px]`}>
                                      {subInfo.statusText}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] border-border">
                                      {u.plan_tier === 'pro' ? 'Pro' : 'Plus'} ·{' '}
                                      {u.billing_cycle === 'monthly' ? 'شهري' : 'سنوي'}
                                    </Badge>
                                  </div>
                                  <p className="text-[11px] font-mono text-muted-foreground">
                                    ينتهي: {formatDateDisplay(u.subscription_end_date)}
                                  </p>
                                </div>
                              )}
                            </td>

                            {/* Column 4: AI Quota & Google Sheets */}
                            <td className="py-3 px-3 hidden md:table-cell">
                              {u.role === 'admin' ? (
                                <span className="text-xs text-muted-foreground font-mono">حصة مفتوحة (∞)</span>
                              ) : (
                                <div className="space-y-1 max-w-[160px]">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="font-mono font-bold text-foreground">
                                      {u.ai_usage_count || 0} / {u.ai_quota_limit ?? 50}
                                    </span>
                                    {u.has_google_service ? (
                                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                        شيت مربوط ✔
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                        غير مربوط
                                      </span>
                                    )}
                                  </div>
                                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className={`h-full ${
                                        (u.ai_usage_count || 0) >= (u.ai_quota_limit ?? 50)
                                          ? 'bg-rose-500'
                                          : 'bg-emerald-500'
                                      }`}
                                      style={{
                                        width: `${Math.min(
                                          100,
                                          Math.round(
                                            ((u.ai_usage_count || 0) / ((u.ai_quota_limit ?? 50) || 1)) * 100,
                                          ),
                                        )}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                            </td>

                            {/* Column 5: Concise Actions */}
                            <td className="py-3 px-4 text-end">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedUser(u);
                                    setIsDetailsDrawerOpen(true);
                                  }}
                                  className="h-8 px-2.5 text-xs gap-1.5 font-semibold"
                                >
                                  <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                                  <span>تفاصيل وتحكم</span>
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="تعديل الحساب"
                                  aria-label={`تعديل ${u.username}`}
                                  onClick={() => openEditModalForUser(u)}
                                  className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="حذف الحساب"
                                  aria-label={`حذف ${u.username}`}
                                  disabled={isCurrent || (u.role === 'admin' && activeAdminCount <= 1)}
                                  onClick={() => {
                                    setSelectedUser(u);
                                    setIsDeleteModalOpen(true);
                                  }}
                                  className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500 disabled:opacity-30"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Supabase Configuration */}
        {activeTab === 'supabase' && (
          <div className="space-y-6 fade-in-up">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 text-foreground">
                  <Database className="w-5 h-5 text-sky-500" />
                  <span>تهيئة والاتصال بقاعدة بيانات Supabase</span>
                </h2>
                <p className="text-xs text-muted-foreground">
                  تخزين مركزي دائم للحسابات والاشتراكات وحصص الذكاء الاصطناعي وسجل الجلسات الموثقة
                </p>
              </div>

              <Badge
                className={`gap-1.5 text-xs py-1 px-3 ${
                  isSupabaseConfigured
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSupabaseConfigured ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
                <span>{isSupabaseConfigured ? 'متصل بـ Supabase' : 'تخزين محلي للتطوير'}</span>
              </Badge>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <span>بيانات الاتصال ومفتاح الخدمة السري</span>
                </h3>

                <form onSubmit={handleSaveSupabaseSettings} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="supabase_url_input" className="text-xs font-semibold">
                      رابط مشروع Supabase (Project URL) *
                    </Label>
                    <Input
                      id="supabase_url_input"
                      type="url"
                      placeholder="https://xyzcompany.supabase.co"
                      value={supabaseUrl}
                      onChange={(e) => setSupabaseUrl(e.target.value)}
                      className="font-mono text-xs"
                      dir="ltr"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="supabase_key_input" className="text-xs font-semibold">
                        مفتاح الخدمة السري (Service Role Key) {supabaseKeyIsSet ? '(محفوظ بالخادم)' : '*'}
                      </Label>
                      <button
                        type="button"
                        onClick={() => setShowSupabaseKey(!showSupabaseKey)}
                        className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        {showSupabaseKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        <span>{showSupabaseKey ? 'إخفاء' : 'إظهار'}</span>
                      </button>
                    </div>
                    <Input
                      id="supabase_key_input"
                      type={showSupabaseKey ? 'text' : 'password'}
                      placeholder={
                        supabaseKeyIsSet
                          ? 'المفتاح محفوظ بالخادم — اتركه فارغاً للإبقاء عليه'
                          : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                      }
                      value={supabaseKey}
                      onChange={(e) => setSupabaseKey(e.target.value)}
                      className="font-mono text-xs"
                      dir="ltr"
                      required={!supabaseKeyIsSet}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="supabase_table_input" className="text-xs font-semibold">
                      اسم جدول المستخدمين (Table Name) *
                    </Label>
                    <Input
                      id="supabase_table_input"
                      placeholder="app_users"
                      value={supabaseTableName}
                      onChange={(e) => setSupabaseTableName(e.target.value)}
                      className="font-mono text-xs"
                      dir="ltr"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={savingSupabase}
                    className="w-full text-xs text-white gap-2"
                    style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' }}
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingSupabase ? 'جارٍ الحفظ...' : 'حفظ إعدادات قاعدة البيانات'}</span>
                  </Button>
                </form>
              </div>

              <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <div className="flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-emerald-500" />
                      <h3 className="text-sm font-bold text-foreground">سكربت SQL المحدّث</h3>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopySql}
                      className="h-7 text-xs gap-1.5"
                    >
                      {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedSql ? 'تم النسخ!' : 'نسخ كود SQL'}</span>
                    </Button>
                  </div>

                  <div
                    className="relative rounded-xl border border-border bg-muted/60 p-3 max-h-[340px] overflow-y-auto font-mono text-[11px]"
                    dir="ltr"
                  >
                    <pre className="text-muted-foreground whitespace-pre leading-relaxed select-all">
                      {generateSupabaseSqlScript(supabaseTableName)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Plans */}
        {activeTab === 'plans' && (
          <div className="space-y-8 fade-in-up">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
              <div className="rounded-3xl border-2 border-sky-500/40 bg-card p-8 shadow-lg flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 text-xs px-3 py-1 font-bold gap-1">
                    <Zap className="w-3.5 h-3.5" />
                    <span>باقة بلس (Plus Plan)</span>
                  </Badge>
                  <h3 className="text-2xl font-black text-foreground">باقة المحامي المستقل</h3>
                  <ul className="space-y-2 text-xs text-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span>50 تحليل ذكي للرسائل شهرياً (تتجدد آلياً كل شهر)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span>عزل كامل لبيانات المكتب وجدول Google Sheets الخاص</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span>إدارة القضايا والجلسات والوكالات والمهام والأحكام</span>
                    </li>
                  </ul>
                </div>

                <Button
                  onClick={() =>
                    openAddModalWithDefaults(
                      { plan_tier: 'plus', ai_quota_limit: 50, billing_cycle: 'annual' },
                      '1y',
                    )
                  }
                  className="w-full h-11 text-sm font-bold bg-sky-600 hover:bg-sky-700 text-white gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>تسجيل مشترك جديد بباقة Plus (سنوي)</span>
                </Button>
              </div>

              <div className="rounded-3xl border-2 border-amber-500 bg-card p-8 shadow-xl flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 text-xs px-3 py-1 font-bold gap-1">
                    <Crown className="w-3.5 h-3.5 text-amber-500" />
                    <span>باقة برو للمكاتب (Pro Plan)</span>
                  </Badge>
                  <h3 className="text-2xl font-black text-foreground">باقة مكاتب المحاماة المتكاملة</h3>
                  <ul className="space-y-2 text-xs text-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>300 تحليل ذكي للرسائل شهرياً (تتجدد آلياً كل شهر)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>إدارة فريق المكتب وتعدد الأدوار (مدير مكتب، محامٍ، مساعد، محاسب)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>ملف القضية الموحد والعملاء والمطالبات المالية وسجل التدقيق</span>
                    </li>
                  </ul>
                </div>

                <Button
                  onClick={() =>
                    openAddModalWithDefaults(
                      { plan_tier: 'pro', ai_quota_limit: 300, billing_cycle: 'annual' },
                      '1y',
                    )
                  }
                  className="w-full h-11 text-sm font-bold text-white gap-2"
                  style={{ background: 'linear-gradient(135deg, #B88A3B 0%, #8c6422 100%)' }}
                >
                  <Crown className="w-4 h-4" />
                  <span>تسجيل مكتب جديد بباقة Pro (سنوي)</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Platform Audit Logs */}
        {activeTab === 'audit' && (
          <div className="space-y-4 fade-in-up">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 text-foreground">
                  <History className="w-5 h-5 text-primary" />
                  سجل التدقيق العام للمنصة
                </h2>
                <p className="text-xs text-muted-foreground">
                  توثيق زمني لعمليات إنشاء وتعديل الحسابات وتغييرات الصلاحيات والنسخ الاحتياطي
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchPlatformAuditLogs}
                disabled={auditLoading}
                className="gap-2 text-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
                <span>تحديث السجل</span>
              </Button>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              {auditLoading ? (
                <p className="text-xs text-muted-foreground py-8 text-center">جارٍ تحميل السجل...</p>
              ) : auditLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">لا توجد أحداث مسجلة بعد.</p>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto pe-1">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl border border-border bg-muted/20 text-xs"
                    >
                      <div className="space-y-0.5">
                        <p className="font-semibold text-foreground">{log.summary}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          المنفذ: {log.actorUsername || 'النظام'}
                          {log.officeId ? ` · المكتب: ${log.officeId}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {log.action}
                        </Badge>
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {String(log.timestamp || '').slice(0, 19).replace('T', ' ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Independent User Details & Control Side Panel (Sheet) */}
      <Sheet open={isDetailsDrawerOpen} onOpenChange={setIsDetailsDrawerOpen}>
        <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto bg-card text-foreground border-border" dir="rtl">
          {selectedUser && (() => {
            const subInfo = getSubscriptionInfo(selectedUser);
            const isCurrent = currentUser?.username === selectedUser.username;
            return (
              <div className="space-y-5 pt-2">
                <SheetHeader className="text-start border-b border-border pb-3">
                  <SheetTitle className="text-base font-bold text-foreground flex items-center gap-2">
                    <User className="w-4 h-4 text-primary" />
                    <span>{selectedUser.display_name || selectedUser.username}</span>
                  </SheetTitle>
                  <SheetDescription className="text-xs font-mono">
                    @{selectedUser.username} {selectedUser.email ? `· ${selectedUser.email}` : ''}
                  </SheetDescription>
                </SheetHeader>

                {/* Role & Office Isolation Info */}
                <div className="p-3.5 rounded-xl border border-border bg-muted/25 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">نطاق الحساب:</span>
                    <span className="font-bold text-foreground">
                      {selectedUser.role === 'admin'
                        ? 'مشرف المنصة العام (Admin)'
                        : OFFICE_ROLE_LABELS[selectedUser.office_role || 'office_manager']}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">معرّف المكتب المعزول:</span>
                    <span className="font-mono font-semibold text-foreground">
                      {selectedUser.office_id || `office-${selectedUser.id}`}
                    </span>
                  </div>
                  {selectedUser.whatsapp_number && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">رقم واتساب التنبيهات:</span>
                      <span className="font-mono text-foreground" dir="ltr">
                        {selectedUser.whatsapp_number}
                      </span>
                    </div>
                  )}
                </div>

                {/* Subscription & AI Quota Details */}
                {selectedUser.role === 'staff' && (
                  <div className="p-3.5 rounded-xl border border-border bg-muted/25 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">حالة الاشتراك:</span>
                      <Badge className={`${subInfo.badgeColor} text-[11px]`}>{subInfo.statusText}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">الباقة والفوترة:</span>
                      <span className="font-bold text-foreground">
                        {selectedUser.plan_tier === 'pro' ? 'Pro' : 'Plus'} —{' '}
                        {selectedUser.billing_cycle === 'monthly' ? 'شهري' : 'سنوي'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">تاريخ انتهاء الاشتراك:</span>
                      <span className="font-mono font-bold text-foreground">
                        {formatDateDisplay(selectedUser.subscription_end_date)}
                      </span>
                    </div>
                    {selectedUser.subscription_notes && (
                      <div className="pt-1 border-t border-border/60">
                        <span className="text-muted-foreground block mb-0.5">ملاحظات الاشتراك:</span>
                        <p className="text-foreground">{selectedUser.subscription_notes}</p>
                      </div>
                    )}

                    <div className="pt-2 border-t border-border space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">استهلاك الذكاء الاصطناعي:</span>
                        <span className="font-mono font-bold text-foreground">
                          {selectedUser.ai_usage_count || 0} / {selectedUser.ai_quota_limit ?? 50}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">التجديد الشهري التلقائي القادم:</span>
                        <span className="font-mono text-emerald-600 dark:text-emerald-400">
                          {selectedUser.ai_renewal_date
                            ? normalizeDateForInput(selectedUser.ai_renewal_date)
                            : 'مطلع الشهر القادم'}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionLoading}
                        onClick={() => handleResetAiUsage(selectedUser.id, selectedUser.username)}
                        className="w-full h-8 text-xs gap-1.5 mt-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-emerald-500" />
                        <span>تصفير رصيد الشهر الحالي الآن</span>
                      </Button>
                    </div>
                  </div>
                )}

                {/* Google Sheets Status */}
                <div className="p-3.5 rounded-xl border border-border bg-muted/25 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">ربط Google Sheets للمكتب:</span>
                    {selectedUser.has_google_service ? (
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
                        مكتمل ومربوط
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/30">
                        غير مربوط بعد
                      </Badge>
                    )}
                  </div>
                  {selectedUser.google_spreadsheet_id && (
                    <p className="font-mono text-[11px] text-muted-foreground break-all" dir="ltr">
                      Spreadsheet: {selectedUser.google_spreadsheet_id}
                    </p>
                  )}
                </div>

                {/* Quick Control Actions Grid */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  {selectedUser.role === 'staff' && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionLoading}
                        onClick={() => handleToggleStatus(selectedUser)}
                        className="text-xs gap-1.5 h-9"
                      >
                        {selectedUser.status === 'suspended' ? (
                          <>
                            <Play className="w-3.5 h-3.5 text-emerald-500" />
                            <span>إعادة التفعيل</span>
                          </>
                        ) : (
                          <>
                            <Pause className="w-3.5 h-3.5 text-rose-500" />
                            <span>إيقاف مؤقت</span>
                          </>
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRenewDuration(selectedUser.billing_cycle === 'monthly' ? '1m' : '1y');
                          setCustomRenewDate('');
                          setIsRenewModalOpen(true);
                        }}
                        className="text-xs gap-1.5 h-9"
                      >
                        <RotateCw className="w-3.5 h-3.5 text-amber-500" />
                        <span>تجديد الاشتراك</span>
                      </Button>
                    </>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setNewPassword('');
                      setIsPasswordModalOpen(true);
                    }}
                    className="text-xs gap-1.5 h-9"
                  >
                    <Key className="w-3.5 h-3.5 text-amber-500" />
                    <span>تغيير كلمة المرور</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setHandoverData({
                        username: selectedUser.username,
                        displayName: selectedUser.display_name || selectedUser.username,
                        password: '',
                        loginUrl: `${window.location.origin}/login`,
                        subscriptionEndDate: selectedUser.subscription_end_date || null,
                        subscriptionDurationText: subInfo.statusText,
                        planTier: selectedUser.plan_tier || 'plus',
                        billingCycle: selectedUser.billing_cycle || 'annual',
                        aiQuota: selectedUser.ai_quota_limit ?? 50,
                      });
                      setIsHandoverModalOpen(true);
                    }}
                    className="text-xs gap-1.5 h-9"
                  >
                    <Copy className="w-3.5 h-3.5 text-emerald-500" />
                    <span>بطاقة التسليم</span>
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => openEditModalForUser(selectedUser)}
                    className="text-xs gap-1.5 h-9 col-span-2"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>تعديل بيانات الحساب والربط</span>
                  </Button>

                  {!isCurrent && !(selectedUser.role === 'admin' && activeAdminCount <= 1) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsDeleteModalOpen(true)}
                      className="text-xs gap-1.5 h-9 col-span-2 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف الحساب نهائياً</span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Modal: 3-Step Add User Wizard with Synchronized Expiry & Pre-Save Summary */}
      {isAddOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-user-modal-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          dir="rtl"
        >
          <div className="bg-card border border-border rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 id="add-user-modal-title" className="text-base font-bold flex items-center gap-2 text-foreground">
                <UserPlus className="w-4 h-4 text-primary" />
                <span>إضافة حساب جديد (الخطوة {addStep} من 3)</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                aria-label="إغلاق نافذة الإضافة"
                className="text-muted-foreground hover:text-foreground text-sm font-bold px-2 py-1 rounded-md"
              >
                ✕
              </button>
            </div>

            {/* Step Indicator */}
            <div className="grid grid-cols-3 gap-2 text-[11px] font-bold">
              {[
                { step: 1, title: '1. الحساب والدور' },
                { step: 2, title: '2. الباقة والاشتراك' },
                { step: 3, title: '3. الربط والملخص' },
              ].map((s) => (
                <button
                  key={s.step}
                  type="button"
                  onClick={() => {
                    if (s.step === 1) setAddStep(1);
                    else if (s.step === 2 && validateAddStep1()) setAddStep(2);
                    else if (s.step === 3 && validateAddStep1() && validateAddStep2()) setAddStep(3);
                  }}
                  className={`py-1.5 px-2 rounded-lg border text-center transition-all ${
                    addStep === s.step
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              {/* STEP 1: Account, Unified Strong Password & Role */}
              {addStep === 1 && (
                <div className="space-y-3 p-4 rounded-xl border border-border bg-muted/20">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="new_user_username" className="text-xs font-semibold">
                        اسم المستخدم (Username) *
                      </Label>
                      <Input
                        id="new_user_username"
                        required
                        placeholder="lawyer_office1"
                        value={newUser.username}
                        onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                        className="font-mono text-sm"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="new_user_display_name" className="text-xs font-semibold">
                        الاسم الظاهر / اسم المكتب
                      </Label>
                      <Input
                        id="new_user_display_name"
                        placeholder="مكتب أ. عمر للمحاماة"
                        value={newUser.display_name}
                        onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
                        className="text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="new_user_password" className="text-xs font-semibold">
                      كلمة المرور * (8 خانات على الأقل تحتوي على أحرف وأرقام)
                    </Label>
                    <Input
                      id="new_user_password"
                      required
                      type="password"
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="مثال: Lawyer2026"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      className="font-mono text-sm"
                      dir="ltr"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="new_user_email" className="text-xs font-semibold">
                        البريد الإلكتروني (اختياري)
                      </Label>
                      <Input
                        id="new_user_email"
                        type="email"
                        placeholder="lawyer@office.sa"
                        value={newUser.email}
                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                        className="font-mono text-xs"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="new_user_whatsapp" className="text-xs font-semibold">
                        رقم واتساب التنبيهات (اختياري)
                      </Label>
                      <Input
                        id="new_user_whatsapp"
                        placeholder="966501234567"
                        value={newUser.whatsapp_number}
                        onChange={(e) => setNewUser({ ...newUser, whatsapp_number: e.target.value })}
                        className="font-mono text-xs"
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">نطاق الحساب بالمنصة</Label>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setNewUser({ ...newUser, role: 'staff' })}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                          newUser.role === 'staff'
                            ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            : 'border-border text-muted-foreground'
                        }`}
                      >
                        <Building2 className="w-3.5 h-3.5" />
                        <span>مكتب محاماة / مشترك</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setNewUser({ ...newUser, role: 'admin' })}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                          newUser.role === 'admin'
                            ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'border-border text-muted-foreground'
                        }`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>مشرف المنصة العام</span>
                      </button>
                    </div>
                  </div>

                  {newUser.role === 'staff' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div className="space-y-1">
                        <Label htmlFor="new_office_role" className="text-xs font-semibold">
                          الدور داخل المكتب
                        </Label>
                        <select
                          id="new_office_role"
                          value={newUser.office_role}
                          onChange={(e) =>
                            setNewUser({ ...newUser, office_role: e.target.value as OfficeRole })
                          }
                          className="w-full h-9 rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                        >
                          <option value="office_manager">مدير المكتب (صلاحية كاملة للمكتب)</option>
                          <option value="lawyer">محامٍ ممارس</option>
                          <option value="paralegal">مساعد قانوني</option>
                          <option value="accountant">محاسب مالي</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="new_office_id" className="text-xs font-semibold">
                          معرّف المكتب (اختياري للربط بمكتب قائم)
                        </Label>
                        <Input
                          id="new_office_id"
                          placeholder="يُولّد تلقائياً للمكتب الجديد"
                          value={newUser.office_id}
                          onChange={(e) => setNewUser({ ...newUser, office_id: e.target.value })}
                          className="font-mono text-xs h-9"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2: Synchronized Plan, Billing Cycle & End Date */}
              {addStep === 2 && (
                <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/20">
                  {newUser.role === 'admin' ? (
                    <p className="text-xs text-muted-foreground py-6 text-center">
                      حساب مشرف المنصة يتمتع بصلاحية إدارية دائمة وحصة غير محدودة تلقائياً. انتقل للخطوة التالية للمراجعة والحفظ.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">باقة الاشتراك:</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setNewUser({ ...newUser, plan_tier: 'plus', ai_quota_limit: 50 })}
                            className={`p-2.5 rounded-xl border text-start space-y-1 transition-all ${
                              newUser.plan_tier === 'plus'
                                ? 'border-sky-500 bg-sky-500/15 text-foreground'
                                : 'border-border text-muted-foreground'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-bold text-sky-600 dark:text-sky-400">
                              <Zap className="w-3.5 h-3.5" />
                              <span>باقة بلس (Plus)</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">50 تحليل رسائل/شهر</p>
                          </button>

                          <button
                            type="button"
                            onClick={() => setNewUser({ ...newUser, plan_tier: 'pro', ai_quota_limit: 300 })}
                            className={`p-2.5 rounded-xl border text-start space-y-1 transition-all ${
                              newUser.plan_tier === 'pro'
                                ? 'border-amber-500 bg-amber-500/15 text-foreground'
                                : 'border-border text-muted-foreground'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                              <Crown className="w-3.5 h-3.5" />
                              <span>باقة برو (Pro)</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">300 تحليل رسائل/شهر</p>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">دورة الفوترة (تشتق تاريخ الانتهاء تلقائياً):</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setNewSubscriptionDuration('1y');
                              setNewUser({
                                ...newUser,
                                billing_cycle: 'annual',
                                subscription_end_date: computeEndDate('1y'),
                              });
                            }}
                            className={`p-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                              newUser.billing_cycle === 'annual'
                                ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'border-border text-muted-foreground'
                            }`}
                          >
                            <Calendar className="w-3.5 h-3.5" />
                            <span>سنوي (365 يوماً)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setNewSubscriptionDuration('1m');
                              setNewUser({
                                ...newUser,
                                billing_cycle: 'monthly',
                                subscription_end_date: computeEndDate('1m'),
                              });
                            }}
                            className={`p-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                              newUser.billing_cycle === 'monthly'
                                ? 'border-sky-500 bg-sky-500/15 text-sky-700 dark:text-sky-300'
                                : 'border-border text-muted-foreground'
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>شهري (30 يوماً)</span>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">مدة الاشتراك الممنوحة:</Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {(
                            [
                              { id: '1y', label: 'سنة كاملة (365 يوماً)' },
                              { id: '6m', label: '6 أشهر (180 يوماً)' },
                              { id: '3m', label: '3 أشهر (90 يوماً)' },
                              { id: '1m', label: 'شهر واحد (30 يوماً)' },
                              { id: 'unlimited', label: 'دائم ومفتوح' },
                              { id: 'custom', label: 'تاريخ مخصص' },
                            ] as Array<{ id: SubDurationChoice; label: string }>
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                setNewSubscriptionDuration(opt.id);
                                const syncedCycle =
                                  opt.id === '1m'
                                    ? 'monthly'
                                    : opt.id === '1y'
                                      ? 'annual'
                                      : newUser.billing_cycle;
                                setNewUser({
                                  ...newUser,
                                  billing_cycle: syncedCycle,
                                  subscription_end_date:
                                    opt.id === 'custom'
                                      ? newUser.subscription_end_date
                                      : computeEndDate(opt.id),
                                });
                              }}
                              className={`p-2 rounded-lg border text-xs font-bold transition-all text-center ${
                                newSubscriptionDuration === opt.id
                                  ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                  : 'border-border text-muted-foreground'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {newSubscriptionDuration !== 'unlimited' && (
                        <div className="space-y-1">
                          <Label htmlFor="new_user_sub_end_date" className="text-xs font-semibold">
                            تاريخ انتهاء الاشتراك (YYYY-MM-DD) *
                          </Label>
                          <Input
                            id="new_user_sub_end_date"
                            type="date"
                            required={newSubscriptionDuration === 'custom'}
                            min={new Date().toISOString().split('T')[0]}
                            value={newUser.subscription_end_date}
                            onChange={(e) => {
                              setNewUser({ ...newUser, subscription_end_date: e.target.value });
                              setNewSubscriptionDuration('custom');
                            }}
                            className="font-mono text-sm"
                            dir="ltr"
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="new_user_ai_quota" className="text-xs font-semibold">
                            حصة الذكاء الاصطناعي الشهرية
                          </Label>
                          <Input
                            id="new_user_ai_quota"
                            type="number"
                            min={1}
                            max={9999}
                            value={newUser.ai_quota_limit}
                            onChange={(e) =>
                              setNewUser({ ...newUser, ai_quota_limit: parseInt(e.target.value) || 50 })
                            }
                            className="font-mono text-sm"
                            dir="ltr"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="new_user_sub_notes" className="text-xs font-semibold">
                            ملاحظات الاشتراك
                          </Label>
                          <Input
                            id="new_user_sub_notes"
                            placeholder="اختياري..."
                            value={newUser.subscription_notes}
                            onChange={(e) =>
                              setNewUser({ ...newUser, subscription_notes: e.target.value })
                            }
                            className="text-xs"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* STEP 3: Optional Google Sheets + Pre-Save Review Summary */}
              {addStep === 3 && (
                <div className="space-y-4">
                  <div className="space-y-3 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-xs">
                      <SheetIcon className="w-4 h-4" />
                      <span>ربط Google Sheets الخاص بالمكتب (اختياري الآن)</span>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="new_user_google_json" className="text-xs font-semibold">
                        ملف Google Service Account JSON
                      </Label>
                      <Textarea
                        id="new_user_google_json"
                        placeholder='{"type":"service_account","client_email":"...","private_key":"..."}'
                        value={newUser.google_service_account_json}
                        onChange={(e) =>
                          setNewUser({ ...newUser, google_service_account_json: e.target.value })
                        }
                        className="font-mono text-xs h-20"
                        dir="ltr"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="new_user_spreadsheet_id" className="text-xs font-semibold">
                          معرّف الجدول (Spreadsheet ID)
                        </Label>
                        <Input
                          id="new_user_spreadsheet_id"
                          placeholder="1BxiMVs0XRA5..."
                          value={newUser.google_spreadsheet_id}
                          onChange={(e) =>
                            setNewUser({ ...newUser, google_spreadsheet_id: e.target.value })
                          }
                          className="font-mono text-xs"
                          dir="ltr"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="new_user_sheet_name" className="text-xs font-semibold">
                          اسم الورقة (Sheet Name)
                        </Label>
                        <Input
                          id="new_user_sheet_name"
                          placeholder="Sessions"
                          value={newUser.google_sheet_name}
                          onChange={(e) =>
                            setNewUser({ ...newUser, google_sheet_name: e.target.value })
                          }
                          className="text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Pre-Save Summary Box */}
                  <div className="p-4 rounded-xl border-2 border-amber-500/35 bg-amber-500/5 space-y-2 text-xs">
                    <p className="font-extrabold text-foreground">ملخص الحساب قبل الحفظ:</p>
                    <div className="grid grid-cols-2 gap-y-1.5 text-[11px]">
                      <span className="text-muted-foreground">اسم المستخدم:</span>
                      <span className="font-mono font-bold text-foreground">{newUser.username || '—'}</span>

                      <span className="text-muted-foreground">النطاق والدور:</span>
                      <span className="font-bold text-foreground">
                        {newUser.role === 'admin'
                          ? 'مشرف المنصة العام'
                          : OFFICE_ROLE_LABELS[newUser.office_role]}
                      </span>

                      {newUser.role === 'staff' && (
                        <>
                          <span className="text-muted-foreground">الباقة والفوترة:</span>
                          <span className="font-bold text-foreground">
                            {newUser.plan_tier === 'pro' ? 'Pro' : 'Plus'} —{' '}
                            {newUser.billing_cycle === 'annual' ? 'سنوي' : 'شهري'} (
                            {DURATION_LABELS[newSubscriptionDuration]})
                          </span>

                          <span className="text-muted-foreground">تاريخ انتهاء الاشتراك:</span>
                          <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                            {newSubscriptionDuration === 'unlimited'
                              ? 'اشتراك دائم ومفتوح'
                              : formatDateDisplay(newUser.subscription_end_date)}
                          </span>

                          <span className="text-muted-foreground">حصة التحليل الشهرية:</span>
                          <span className="font-mono font-bold text-foreground">
                            {newUser.ai_quota_limit} رسالة / شهر
                          </span>
                        </>
                      )}

                      <span className="text-muted-foreground">ربط Google Sheets:</span>
                      <span className="font-semibold text-foreground">
                        {newUser.google_spreadsheet_id.trim() ? 'شيت مكتب مخصص' : 'يُربط لاحقاً'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Wizard Navigation Footer */}
              <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
                <div>
                  {addStep > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAddStep((s) => (s === 3 ? 2 : 1))}
                      className="text-xs gap-1"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                      <span>السابق</span>
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddOpen(false)}
                    className="text-xs"
                  >
                    إلغاء
                  </Button>

                  {addStep < 3 ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        if (addStep === 1 && validateAddStep1()) setAddStep(2);
                        else if (addStep === 2 && validateAddStep2()) setAddStep(3);
                      }}
                      className="text-xs gap-1"
                    >
                      <span>التالي</span>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      size="sm"
                      disabled={actionLoading}
                      className="text-xs text-white"
                      style={{ background: 'linear-gradient(135deg, #B88A3B 0%, #966c25 100%)' }}
                    >
                      {actionLoading ? 'جارٍ الحفظ...' : 'تأكيد وحفظ الحساب'}
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Change Password (Unified 8+ chars + letters & digits) */}
      {isPasswordModalOpen && selectedUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-modal-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          dir="rtl"
        >
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 id="password-modal-title" className="text-base font-bold flex items-center gap-2 text-foreground">
                <Key className="w-4 h-4 text-amber-500" />
                <span>تغيير كلمة المرور ({selectedUser.username})</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsPasswordModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold px-2 py-1 rounded-md"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-3.5">
              <div className="space-y-1">
                <Label htmlFor="update_password_input" className="text-xs font-semibold">
                  كلمة المرور الجديدة * (8 خانات على الأقل تشمل أحرفاً وأرقاماً)
                </Label>
                <Input
                  id="update_password_input"
                  required
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="مثال: Office2026"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="font-mono text-sm"
                  dir="ltr"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  سيتم إبطال الجلسات النشطة القديمة لهذا الحساب فور تغيير كلمة المرور.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsPasswordModalOpen(false)}
                  className="text-xs"
                >
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={actionLoading}
                  className="text-xs text-white bg-amber-600 hover:bg-amber-700"
                >
                  {actionLoading ? 'جارٍ التحديث...' : 'تحديث كلمة المرور'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {isEditModalOpen && selectedUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-modal-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          dir="rtl"
        >
          <div className="bg-card border border-border rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 id="edit-user-modal-title" className="text-base font-bold flex items-center gap-2 text-foreground">
                <Edit2 className="w-4 h-4 text-primary" />
                <span>تعديل الحساب ({selectedUser.username})</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold px-2 py-1 rounded-md"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-4 max-h-[75vh] overflow-y-auto pe-1">
              <div className="space-y-3 p-4 rounded-xl border border-border bg-muted/20">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="edit_display_name" className="text-xs font-semibold">
                      الاسم الظاهر
                    </Label>
                    <Input
                      id="edit_display_name"
                      value={editUserData.display_name}
                      onChange={(e) => setEditUserData({ ...editUserData, display_name: e.target.value })}
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="edit_whatsapp" className="text-xs font-semibold">
                      رقم واتساب التنبيهات
                    </Label>
                    <Input
                      id="edit_whatsapp"
                      value={editUserData.whatsapp_number}
                      onChange={(e) =>
                        setEditUserData({ ...editUserData, whatsapp_number: e.target.value })
                      }
                      className="font-mono text-xs"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="edit_email" className="text-xs font-semibold">
                      البريد الإلكتروني
                    </Label>
                    <Input
                      id="edit_email"
                      type="email"
                      value={editUserData.email}
                      onChange={(e) => setEditUserData({ ...editUserData, email: e.target.value })}
                      className="font-mono text-xs"
                      dir="ltr"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="edit_office_id" className="text-xs font-semibold">
                      معرّف المكتب (Office ID)
                    </Label>
                    <Input
                      id="edit_office_id"
                      value={editUserData.office_id}
                      onChange={(e) => setEditUserData({ ...editUserData, office_id: e.target.value })}
                      className="font-mono text-xs"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold">النطاق بالمنصة</Label>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={selectedUser.role === 'admin' && activeAdminCount <= 1}
                      onClick={() => setEditUserData({ ...editUserData, role: 'staff' })}
                      className={`p-2 rounded-xl border text-xs font-bold ${
                        editUserData.role === 'staff'
                          ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                          : 'border-border text-muted-foreground'
                      } ${selectedUser.role === 'admin' && activeAdminCount <= 1 ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      مكتب محاماة / مشترك
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditUserData({ ...editUserData, role: 'admin' })}
                      className={`p-2 rounded-xl border text-xs font-bold ${
                        editUserData.role === 'admin'
                          ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      مشرف المنصة (Admin)
                    </button>
                  </div>
                </div>

                {editUserData.role === 'staff' && (
                  <div className="space-y-1">
                    <Label htmlFor="edit_office_role" className="text-xs font-semibold">
                      الدور داخل المكتب
                    </Label>
                    <select
                      id="edit_office_role"
                      value={editUserData.office_role}
                      onChange={(e) =>
                        setEditUserData({ ...editUserData, office_role: e.target.value as OfficeRole })
                      }
                      className="w-full h-9 rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                    >
                      <option value="office_manager">مدير المكتب</option>
                      <option value="lawyer">محامٍ ممارس</option>
                      <option value="paralegal">مساعد قانوني</option>
                      <option value="accountant">محاسب مالي</option>
                    </select>
                  </div>
                )}
              </div>

              {editUserData.role === 'staff' && (
                <div className="space-y-3 p-4 rounded-xl border border-amber-500/35 bg-amber-500/5">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditUserData({ ...editUserData, plan_tier: 'plus', ai_quota_limit: 50 })}
                      className={`p-2 rounded-xl border text-xs font-bold ${
                        editUserData.plan_tier === 'plus'
                          ? 'border-sky-500 bg-sky-500/15 text-foreground'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      باقة Plus (50/شهر)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditUserData({ ...editUserData, plan_tier: 'pro', ai_quota_limit: 300 })}
                      className={`p-2 rounded-xl border text-xs font-bold ${
                        editUserData.plan_tier === 'pro'
                          ? 'border-amber-500 bg-amber-500/15 text-foreground'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      باقة Pro (300/شهر)
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditUserData({ ...editUserData, billing_cycle: 'annual' })}
                      className={`p-2 rounded-lg border text-xs font-bold ${
                        editUserData.billing_cycle === 'annual'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      فوترة سنوية
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditUserData({ ...editUserData, billing_cycle: 'monthly' })}
                      className={`p-2 rounded-lg border text-xs font-bold ${
                        editUserData.billing_cycle === 'monthly'
                          ? 'border-sky-500 bg-sky-500/15 text-sky-700 dark:text-sky-300'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      فوترة شهرية
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="edit_ai_quota_limit" className="text-[11px]">
                        الحد الشهري للحصة
                      </Label>
                      <Input
                        id="edit_ai_quota_limit"
                        type="number"
                        min={1}
                        max={9999}
                        value={editUserData.ai_quota_limit}
                        onChange={(e) =>
                          setEditUserData({ ...editUserData, ai_quota_limit: parseInt(e.target.value) || 50 })
                        }
                        className="font-mono text-sm h-8"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="edit_status_select" className="text-[11px]">
                        حالة الحساب
                      </Label>
                      <select
                        id="edit_status_select"
                        value={editUserData.status}
                        onChange={(e) =>
                          setEditUserData({
                            ...editUserData,
                            status: e.target.value as 'active' | 'suspended',
                          })
                        }
                        className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                      >
                        <option value="active">نشط (مفعل)</option>
                        <option value="suspended">موقوف مؤقتاً</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditSubDurationMode('date');
                        if (!editUserData.subscription_end_date) {
                          setEditUserData({
                            ...editUserData,
                            subscription_end_date: computeEndDate(
                              editUserData.billing_cycle === 'monthly' ? '1m' : '1y',
                            ),
                          });
                        }
                      }}
                      className={`p-2 rounded-xl border text-xs font-bold ${
                        editSubDurationMode === 'date'
                          ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      محدد بتاريخ انتهاء
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setEditSubDurationMode('unlimited');
                        setEditUserData({ ...editUserData, subscription_end_date: '' });
                      }}
                      className={`p-2 rounded-xl border text-xs font-bold ${
                        editSubDurationMode === 'unlimited'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      اشتراك دائم ومفتوح
                    </button>
                  </div>

                  {editSubDurationMode === 'date' && (
                    <div className="space-y-1">
                      <Label htmlFor="edit_sub_end_date" className="text-xs font-semibold">
                        تاريخ انتهاء الاشتراك *
                      </Label>
                      <Input
                        id="edit_sub_end_date"
                        type="date"
                        required
                        value={normalizeDateForInput(editUserData.subscription_end_date)}
                        onChange={(e) =>
                          setEditUserData({ ...editUserData, subscription_end_date: e.target.value })
                        }
                        className="font-mono text-sm"
                        dir="ltr"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor="edit_sub_notes" className="text-xs font-semibold">
                      ملاحظات الاشتراك
                    </Label>
                    <Input
                      id="edit_sub_notes"
                      value={editUserData.subscription_notes}
                      onChange={(e) =>
                        setEditUserData({ ...editUserData, subscription_notes: e.target.value })
                      }
                      className="text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  <span>تخصيص Google Sheets للمكتب</span>
                  {selectedUser.has_google_service && <span>✔ معيّن مسبقاً</span>}
                </div>

                <Textarea
                  placeholder={
                    selectedUser.has_google_service
                      ? 'اتركه فارغاً للإبقاء على المفتاح الحالي، أو الصق مفتاح JSON جديداً...'
                      : 'الصق محتوى Google Service Account JSON هنا...'
                  }
                  value={editUserData.google_service_account_json}
                  onChange={(e) =>
                    setEditUserData({ ...editUserData, google_service_account_json: e.target.value })
                  }
                  className="font-mono text-xs h-20"
                  dir="ltr"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    placeholder="Spreadsheet ID"
                    value={editUserData.google_spreadsheet_id}
                    onChange={(e) =>
                      setEditUserData({ ...editUserData, google_spreadsheet_id: e.target.value })
                    }
                    className="font-mono text-xs"
                    dir="ltr"
                  />
                  <Input
                    placeholder="Sessions"
                    value={editUserData.google_sheet_name}
                    onChange={(e) =>
                      setEditUserData({ ...editUserData, google_sheet_name: e.target.value })
                    }
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditModalOpen(false)}
                  className="text-xs"
                >
                  إلغاء
                </Button>
                <Button type="submit" size="sm" disabled={actionLoading} className="text-xs">
                  {actionLoading ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Renew Subscription */}
      {isRenewModalOpen && selectedUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="renew-modal-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          dir="rtl"
        >
          <div className="bg-card border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 id="renew-modal-title" className="text-base font-bold text-foreground">
                  تجديد وتمديد اشتراك المكتب
                </h3>
                <p className="text-xs text-muted-foreground">
                  {selectedUser.display_name || selectedUser.username}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRenewModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold px-2 py-1 rounded-md"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRenewSubscription} className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: '1y', label: '+ سنة كاملة (365 يوماً)' },
                  { id: '6m', label: '+ 6 أشهر (180 يوماً)' },
                  { id: '3m', label: '+ 3 أشهر (90 يوماً)' },
                  { id: '1m', label: '+ شهر واحد (30 يوماً)' },
                  { id: 'custom', label: 'تاريخ مخصص' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setRenewDuration(opt.id as any)}
                    className={`p-2.5 rounded-xl border text-xs font-bold text-center ${
                      renewDuration === opt.id
                        ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {renewDuration === 'custom' && (
                <Input
                  type="date"
                  required
                  min={new Date().toISOString().split('T')[0]}
                  value={customRenewDate}
                  onChange={(e) => setCustomRenewDate(e.target.value)}
                  className="font-mono text-sm"
                  dir="ltr"
                />
              )}

              {(() => {
                const preview = getRenewalPreviewInfo();
                return (
                  <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">تاريخ الانتهاء الجديد:</span>
                      <span className="font-mono font-extrabold text-amber-600 dark:text-amber-300">
                        {formatDateDisplay(preview.targetDate)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{preview.ruleDescription}</p>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsRenewModalOpen(false)}
                  className="text-xs"
                >
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={actionLoading}
                  className="text-xs text-white bg-amber-600 hover:bg-amber-700 font-bold"
                >
                  {actionLoading ? 'جارٍ التجديد...' : 'تأكيد التجديد'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {isDeleteModalOpen && selectedUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          dir="rtl"
        >
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 id="delete-modal-title" className="text-base font-bold text-foreground">
              تأكيد حذف الحساب ({selectedUser.username})
            </h3>
            <p className="text-xs text-muted-foreground">
              سيتم حذف الحساب وإبطال أي جلسة دخول نشطة له فوراً. هل أنت متأكد؟
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsDeleteModalOpen(false)}
                className="text-xs"
              >
                إلغاء
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={actionLoading}
                onClick={handleDeleteUser}
                className="text-xs bg-red-600 hover:bg-red-700 text-white"
              >
                {actionLoading ? 'جارٍ الحذف...' : 'نعم، احذف الحساب'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Handover Card */}
      {isHandoverModalOpen && handoverData && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="handover-modal-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          dir="rtl"
        >
          <div className="bg-card border border-emerald-500/30 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 id="handover-modal-title" className="text-base font-extrabold text-foreground">
                بطاقة تسليم الحساب للمشترك
              </h3>
              <button
                type="button"
                onClick={() => setIsHandoverModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold px-2 py-1 rounded-md"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">المكتب / المحامي:</span>
                <span className="font-bold text-foreground">
                  {handoverData.displayName || handoverData.username}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">اسم المستخدم:</span>
                <span className="font-mono font-bold text-foreground">{handoverData.username}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">كلمة المرور:</span>
                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                  {handoverData.password || 'مشفرة ومحفوظة بالخادم'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">صلاحية الاشتراك:</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {handoverData.subscriptionEndDate
                    ? formatDateDisplay(handoverData.subscriptionEndDate)
                    : 'اشتراك دائم ومفتوح'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleCopyHandover}
                className="flex-1 gap-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 h-10"
              >
                {copiedHandover ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedHandover ? 'تم النسخ!' : 'نسخ بطاقة التسليم كاملة'}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsHandoverModalOpen(false)}
                className="text-xs h-10"
              >
                إغلاق
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
