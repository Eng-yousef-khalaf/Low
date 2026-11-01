import { useState, useEffect } from 'react';
import {
  Save,
  Eye,
  EyeOff,
  CheckCircle2,
  Settings2,
  Bot,
  Sheet,
  MessageSquare,
  Send,
  ShieldAlert,
  ShieldCheck,
  Database,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { Link } from 'wouter';

interface DiagnosticStage {
  stage: string;
  status: 'success' | 'failed' | 'warning';
  message: string;
  solution?: string;
}

interface GoogleSheetsDiagResult {
  success: boolean;
  spreadsheetId: string;
  sheetName: string;
  stages: DiagnosticStage[];
  serviceAccountEmail: string | null;
  summary: string;
}

interface SupabaseDiagResult {
  mode: string;
  database_url_configured: boolean;
  connected: boolean;
  tables_status: Array<{ table: string; status: 'ready' | 'missing'; row_count: number }>;
  security: {
    rls_enabled: boolean;
    service_role_key_protected: boolean;
    office_isolation: string;
  };
  message: string;
}

interface SettingsData {
  aiApiKey: string;
  aiApiKeyIsSet: boolean;
  aiModel: string;
  aiBaseUrl: string;
  googleSpreadsheetId: string;
  googleSheetName: string;
  hfApiToken: string;
  hfApiTokenIsSet: boolean;
  hfModel: string;
  whatsappNumber: string;
  whatsappApiUrl: string;
  whatsappToken: string;
  whatsappTokenIsSet: boolean;
  whatsappInstanceId: string;
}

interface SettingsFormState {
  aiApiKey: string;
  aiModel: string;
  aiBaseUrl: string;
  googleSpreadsheetId: string;
  googleSheetName: string;
  hfApiToken: string;
  hfModel: string;
  whatsappNumber: string;
  whatsappApiUrl: string;
  whatsappToken: string;
  whatsappInstanceId: string;
}

async function fetchSettings(): Promise<SettingsData> {
  const res = await fetch('/api/settings', { credentials: 'include' });
  if (res.status === 401) {
    throw new Error('يرجى تسجيل الدخول أولاً لتصفح الإعدادات');
  }
  if (!res.ok) {
    throw new Error(`فشل تحميل الإعدادات (${res.status})`);
  }
  return res.json() as Promise<SettingsData>;
}

async function updateSettings(body: Partial<SettingsFormState>): Promise<SettingsData> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'فشل حفظ الإعدادات');
  }
  return res.json() as Promise<SettingsData>;
}

async function triggerTestWhatsapp(): Promise<{ message: string }> {
  const res = await fetch('/api/settings/test-whatsapp', {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'فشل إجراء تجربة الواتساب');
  }
  return res.json() as Promise<{ message: string }>;
}

function SettingField({
  id,
  label,
  description,
  placeholder,
  value,
  onChange,
  type = 'text',
  mono = false,
  dir = 'ltr',
  testId,
  rightContent,
}: {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  dir?: 'ltr' | 'rtl' | 'auto';
  testId?: string;
  rightContent?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${mono ? 'font-mono' : ''} h-9 text-sm ${rightContent ? 'pe-10' : ''}`}
          dir={dir}
          data-testid={testId}
          autoComplete="off"
        />
        {rightContent && (
          <div className="absolute inset-y-0 end-0 px-3 flex items-center">
            {rightContent}
          </div>
        )}
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: currentUser, isLoading: loadingUser } = useGetCurrentUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingWhatsapp, setTestingWhatsapp] = useState(false);
  const [testingSheets, setTestingSheets] = useState(false);
  const [sheetsDiag, setSheetsDiag] = useState<GoogleSheetsDiagResult | null>(null);
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [supabaseDiag, setSupabaseDiag] = useState<SupabaseDiagResult | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const [showToken, setShowToken] = useState(false);
  const [tokenIsSet, setTokenIsSet] = useState(false);
  
  const [showHfToken, setShowHfToken] = useState(false);
  const [hfTokenIsSet, setHfTokenIsSet] = useState(false);

  const [showWaToken, setShowWaToken] = useState(false);
  const [waTokenIsSet, setWaTokenIsSet] = useState(false);

  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [form, setForm] = useState<SettingsFormState>({
    aiApiKey: '',
    aiModel: '',
    aiBaseUrl: '',
    googleSpreadsheetId: '',
    googleSheetName: '',
    hfApiToken: '',
    hfModel: '',
    whatsappNumber: '',
    whatsappApiUrl: '',
    whatsappToken: '',
    whatsappInstanceId: '',
  });

  const [maskedToken, setMaskedToken] = useState('');
  const [maskedHfToken, setMaskedHfToken] = useState('');
  const [maskedWaToken, setMaskedWaToken] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchSettings()
      .then((data) => {
        setTokenIsSet(data.aiApiKeyIsSet);
        setMaskedToken(data.aiApiKey);
        setHfTokenIsSet(data.hfApiTokenIsSet);
        setMaskedHfToken(data.hfApiToken);
        setWaTokenIsSet(data.whatsappTokenIsSet);
        setMaskedWaToken(data.whatsappToken);

        setForm({
          aiApiKey: '',
          aiModel: data.aiModel,
          aiBaseUrl: data.aiBaseUrl,
          googleSpreadsheetId: data.googleSpreadsheetId,
          googleSheetName: data.googleSheetName,
          hfApiToken: '',
          hfModel: data.hfModel,
          whatsappNumber: data.whatsappNumber,
          whatsappApiUrl: data.whatsappApiUrl,
          whatsappToken: '',
          whatsappInstanceId: data.whatsappInstanceId,
        });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'فشل تحميل الإعدادات';
        toast({ title: 'خطأ', description: msg, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Partial<SettingsFormState> = {
        aiModel: form.aiModel,
        aiBaseUrl: form.aiBaseUrl,
        googleSpreadsheetId: form.googleSpreadsheetId,
        googleSheetName: form.googleSheetName,
        hfModel: form.hfModel,
        whatsappNumber: form.whatsappNumber,
        whatsappApiUrl: form.whatsappApiUrl,
        whatsappInstanceId: form.whatsappInstanceId,
      };
      if (form.aiApiKey.trim()) {
        payload.aiApiKey = form.aiApiKey.trim();
      }
      if (form.hfApiToken.trim()) {
        payload.hfApiToken = form.hfApiToken.trim();
      }
      if (form.whatsappToken.trim()) {
        payload.whatsappToken = form.whatsappToken.trim();
      }

      const updated = await updateSettings(payload);
      setTokenIsSet(updated.aiApiKeyIsSet);
      setMaskedToken(updated.aiApiKey);
      setHfTokenIsSet(updated.hfApiTokenIsSet);
      setMaskedHfToken(updated.hfApiToken);
      setWaTokenIsSet(updated.whatsappTokenIsSet);
      setMaskedWaToken(updated.whatsappToken);

      setForm((prev) => ({
        ...prev,
        aiApiKey: '',
        hfApiToken: '',
        whatsappToken: '',
      }));
      setSavedAt(new Date());
      toast({ title: 'تم الحفظ ✅', description: 'تم حفظ الإعدادات بنجاح.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل حفظ الإعدادات';
      toast({ title: 'خطأ', description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestWhatsapp = async () => {
    setTestingWhatsapp(true);
    try {
      const res = await triggerTestWhatsapp();
      toast({
        title: 'نجاح الإرسال 📲',
        description: res.message || 'تم إرسال رسالة الواتساب التجريبية بنجاح.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل إرسال رسالة الواتساب';
      toast({ title: 'خطأ في الإرسال', description: msg, variant: 'destructive' });
    } finally {
      setTestingWhatsapp(false);
    }
  };

  const handleTestGoogleSheets = async () => {
    setTestingSheets(true);
    setSheetsDiag(null);
    try {
      const res = await fetch('/api/settings/test-google-sheets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleSpreadsheetId: form.googleSpreadsheetId,
          googleSheetName: form.googleSheetName,
        }),
      });
      const data = (await res.json()) as GoogleSheetsDiagResult;
      setSheetsDiag(data);
      if (data.success) {
        toast({ title: 'فحص الاتصال ناجح ✅', description: data.summary });
      } else {
        toast({
          title: 'تنبيه الاتصال ⚠️',
          description: data.summary || 'تم اكتشاف متطلبات تحتاج ضبط في Google Sheets.',
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      toast({
        title: 'فشل الفحص',
        description: err instanceof Error ? err.message : 'تعذر تشغيل فحص الاتصال',
        variant: 'destructive',
      });
    } finally {
      setTestingSheets(false);
    }
  };

  const handleTestSupabase = async () => {
    setTestingSupabase(true);
    setSupabaseDiag(null);
    try {
      const res = await fetch('/api/settings/test-supabase', {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json()) as SupabaseDiagResult;
      setSupabaseDiag(data);
      toast({ title: 'تقرير حالة التخزين والأمان 🛡️', description: data.message });
    } catch (err: unknown) {
      toast({
        title: 'فشل الفحص',
        description: err instanceof Error ? err.message : 'تعذر فحص قاعدة البيانات والتخزين',
        variant: 'destructive',
      });
    } finally {
      setTestingSupabase(false);
    }
  };

  const field = (k: keyof SettingsFormState, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  if (loading || loadingUser) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-xs text-muted-foreground">جارٍ تحميل الإعدادات...</p>
        </div>
      </div>
    );
  }

  // Non-admin Access Denial (Requirement 4)
  if (currentUser && currentUser.role !== 'admin') {
    return (
      <div className="p-8 max-w-md mx-auto min-h-[60vh] flex flex-col items-center justify-center text-center space-y-4" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-destructive/15 text-destructive flex items-center justify-center">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-xl font-bold text-foreground">صفحة مقيدة للمشرف العام فقط</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            حسابك مخصص للمحامي ومتابعة القضايا. الإعدادات المركزية ومفاتيح الربط محصورة بإدارة النظام لضمان الحماية والسرية.
          </p>
        </div>
        <Link href="/dashboard">
          <Button variant="outline" className="gap-2 text-xs font-bold cursor-pointer">
            العودة إلى لوحة التحكم
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div className="fade-in-up">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1 h-6 rounded-full bg-primary" />
          <h1 className="text-2xl font-bold tracking-tight">إعدادات المنصة</h1>
        </div>
        <p className="text-muted-foreground text-sm mr-3">
          تحكّم في إعدادات تذكير الواتساب، مفاتيح الذكاء الاصطناعي، والربط مع Google Sheets
        </p>
      </div>

      {/* Saved Alert */}
      {savedAt && (
        <div className="fade-in-up rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            آخر حفظ: {savedAt.toLocaleTimeString('ar-SA')}
          </p>
        </div>
      )}

      {/* Google Sheets Settings & Diagnostics Card */}
      <div className="fade-in-up rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Sheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">جوجل شيت (Google Sheets)</p>
              <p className="text-xs text-muted-foreground">
                معرّف الجدول، اسم ورقة العمل، وفحص صلاحيات حساب الخدمة
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTestGoogleSheets}
            disabled={testingSheets}
            className="gap-2 text-xs border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testingSheets ? 'animate-spin' : ''}`} />
            {testingSheets ? 'جارٍ فحص المراحل...' : 'فحص تشخيص اتصال Google Sheets'}
          </Button>
        </div>

        <div className="p-5 space-y-4">
          <SettingField
            id="googleSpreadsheetId"
            label="معرّف الجدول (Spreadsheet ID)"
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
            value={form.googleSpreadsheetId}
            onChange={(v) => field('googleSpreadsheetId', v)}
            mono
            dir="ltr"
            description="انسخ المعرّف من رابط جدول جوجل الخاص بك بين /d/ و /edit"
            testId="input-google-spreadsheet-id"
          />

          <SettingField
            id="googleSheetName"
            label="اسم ورقة العمل (Sheet Name)"
            placeholder="Sheet1"
            value={form.googleSheetName}
            onChange={(v) => field('googleSheetName', v)}
            description="اسم التبويب داخل ملف الإكسل (الافتراضي: Sheet1)"
            testId="input-google-sheet-name"
          />

          {/* Diagnostic Result Report (Requirement 1) */}
          {sheetsDiag && (
            <div className={`mt-4 rounded-xl border p-4 space-y-3 ${
              sheetsDiag.success
                ? 'border-emerald-500/30 bg-emerald-500/8'
                : 'border-amber-500/40 bg-amber-500/10'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {sheetsDiag.success ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  )}
                  <h4 className="text-sm font-bold">
                    {sheetsDiag.success ? 'اتصال Google Sheets جاهز وموثق بنجاح' : 'تنبيه: تم اكتشاف متطلبات اتصال تحتاج ضبط'}
                  </h4>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  sheetsDiag.success ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
                }`}>
                  {sheetsDiag.success ? 'متصل ومحرر' : 'تحقق من الصلاحيات'}
                </span>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {sheetsDiag.summary}
              </p>

              {/* Service Account Email Copy Banner */}
              {sheetsDiag.serviceAccountEmail && (
                <div className="rounded-lg border border-border bg-background p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-semibold block text-foreground">إيميل حساب الخدمة المطلوب مشاركته كمحرر (Editor):</span>
                    <span className="font-mono text-muted-foreground select-all">{sheetsDiag.serviceAccountEmail}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (sheetsDiag.serviceAccountEmail) {
                        navigator.clipboard.writeText(sheetsDiag.serviceAccountEmail);
                        setCopiedEmail(true);
                        setTimeout(() => setCopiedEmail(false), 2000);
                        toast({ title: 'تم النسخ 📋', description: 'تم نسخ إيميل حساب الخدمة إلى الحافظة.' });
                      }
                    }}
                    className="px-3 py-1.5 rounded-md border border-border hover:bg-muted text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer self-start sm:self-auto"
                  >
                    {copiedEmail ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedEmail ? 'تم النسخ' : 'نسخ الإيميل'}</span>
                  </button>
                </div>
              )}

              {/* Stages Checklist */}
              <div className="space-y-2 pt-1">
                <p className="text-xs font-bold text-foreground">فحص مراحل الربط التفصيلي (5 مراحل):</p>
                <div className="grid gap-2">
                  {sheetsDiag.stages.map((stage, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-border/70 bg-card/60 p-2.5 text-xs flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold flex items-center gap-1.5">
                          {stage.status === 'success' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : stage.status === 'warning' ? (
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                          )}
                          {stage.stage}
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                          stage.status === 'success'
                            ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
                            : stage.status === 'warning'
                            ? 'text-amber-700 dark:text-amber-400 bg-amber-500/10'
                            : 'text-destructive bg-destructive/10'
                        }`}>
                          {stage.status === 'success' ? 'ناجح' : stage.status === 'warning' ? 'تنبيه' : 'فشل'}
                        </span>
                      </div>
                      <p className="text-muted-foreground mr-5">{stage.message}</p>
                      {stage.solution && (
                        <p className="text-amber-700 dark:text-amber-300 font-medium mr-5 text-[11px] bg-amber-500/10 p-1.5 rounded">
                          💡 الحل المقترح: {stage.solution}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Database, Supabase & Data Persistence Card (Requirement 9) */}
      <div className="fade-in-up rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">حفظ البيانات، Supabase وعزل المكاتب</p>
              <p className="text-xs text-muted-foreground">
                التحقق من مكان حفظ الحسابات، ثبات البيانات بعد إعادة التشغيل، وسياسات الحماية
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTestSupabase}
            disabled={testingSupabase}
            className="gap-2 text-xs border-blue-500/40 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10 cursor-pointer"
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${testingSupabase ? 'animate-spin' : ''}`} />
            {testingSupabase ? 'جارٍ الفحص...' : 'فحص التخزين وعزل المكاتب'}
          </Button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
              <span className="text-muted-foreground font-semibold block">نمط التخزين المعتمد:</span>
              <span className="font-bold text-foreground">تخزين محلي آمن دائم (Persistent Disk)</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                تُحفظ البيانات في ملفات JSON منظمة ومحمية لا تضيع عند إعادة تشغيل الخادم.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
              <span className="text-muted-foreground font-semibold block">عزل بيانات المكاتب:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">معزول برمجياً بالكامل</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                كل مكتب ومحامٍ مفصول عبر `office_id` و `user_id`، ولا يمكن لأي حساب الوصول لبيانات مكتب آخر.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
              <span className="text-muted-foreground font-semibold block">حماية الجداول والمفاتيح:</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">محمية بخوادم API آمنة</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                لا تُكشف المفاتيح في المتصفح، ويتم التحقق من الصلاحيات قبل كل استعلام.
              </p>
            </div>
          </div>

          {supabaseDiag && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/8 p-4 space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                <h4 className="font-bold text-foreground">تقرير فحص أمان ومثابرة البيانات:</h4>
              </div>
              <p className="text-muted-foreground leading-relaxed">{supabaseDiag.message}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {supabaseDiag.tables_status.map((t) => (
                  <div key={t.table} className="rounded-lg border border-border bg-background p-2.5 text-center">
                    <span className="font-mono font-bold block text-foreground">{t.table}</span>
                    <span className="text-[11px] text-muted-foreground">عدد السجلات: {t.row_count}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-border/60 text-[11px] text-muted-foreground flex flex-wrap gap-4">
                <span>🔒 سياسة الوصول RLS: <strong>{supabaseDiag.security.rls_enabled ? 'مفعلة' : 'محمية بخادم التطبيق'}</strong></span>
                <span>🏢 عزل المكاتب: <strong>{supabaseDiag.security.office_isolation}</strong></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* WhatsApp Reminders Settings Card */}
      <div className="fade-in-up rounded-xl border border-emerald-500/30 bg-card overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-emerald-500/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                إعدادات تذكير الواتساب (WhatsApp Gateway)
              </p>
              <p className="text-xs text-muted-foreground">
                إرسال التنبيهات الآلية قبل الجلسات بـ 24 ساعة للمحامين والموكلين
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTestWhatsapp}
            disabled={testingWhatsapp}
            className="gap-2 text-xs border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
          >
            <Send className="w-3.5 h-3.5" />
            {testingWhatsapp ? 'جارٍ الإرسال التجريبي...' : 'إرسال رسالة تجريبية'}
          </Button>
        </div>

        <div className="p-5 space-y-4">
          <SettingField
            id="whatsappNumber"
            label="رقم الهاتف المستلم الافتراضي للتنبيهات"
            placeholder="966500000000"
            value={form.whatsappNumber}
            onChange={(v) => field('whatsappNumber', v)}
            mono
            dir="ltr"
            description="الرقم بصيغة دولية بدون أصفار أو علامة + (مثال: 966501234567)"
          />

          <SettingField
            id="whatsappApiUrl"
            label="رابط الـ API لبوابة الواتساب (WhatsApp Gateway URL)"
            placeholder="https://api.ultramsg.com أو https://api.green-api.com"
            value={form.whatsappApiUrl}
            onChange={(v) => field('whatsappApiUrl', v)}
            mono
            dir="ltr"
            description="رابط خدمة الواتساب المستخدمة (UltraMsg / GreenAPI / Custom Webhook)"
          />

          <SettingField
            id="whatsappInstanceId"
            label="معرّف المثيل (Instance ID / Channel ID)"
            placeholder="instance123456"
            value={form.whatsappInstanceId}
            onChange={(v) => field('whatsappInstanceId', v)}
            mono
            dir="ltr"
            description="رقم المثيل من لوحة تحكم مزود خدمة الواتساب"
          />

          <div className="space-y-1.5">
            <Label htmlFor="whatsappToken" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              رمز التوثيق / التوكن (WhatsApp Token / API Key)
              {waTokenIsSet && (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold normal-case tracking-normal text-xs bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  ✔ محدَّد
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                id="whatsappToken"
                type={showWaToken ? 'text' : 'password'}
                placeholder={
                  waTokenIsSet
                    ? `القيمة الحالية: ${maskedWaToken} — اتركه فارغاً للإبقاء عليها`
                    : 'أدخل توكن الواتساب هنا...'
                }
                value={form.whatsappToken}
                onChange={(e) => field('whatsappToken', e.target.value)}
                className="font-mono h-9 text-sm pe-10"
                dir="ltr"
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute inset-y-0 end-0 px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowWaToken((v) => !v)}
                tabIndex={-1}
              >
                {showWaToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              مفتاح الأمان الخاص بربط الواتساب.
            </p>
          </div>
        </div>
      </div>

      {/* AI Settings Card */}
      <div className="fade-in-up rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/40">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">الذكاء الاصطناعي (AI Integration)</p>
            <p className="text-xs text-muted-foreground">
              مفتاح ونموذج الذكاء الاصطناعي لتحليل رسائل الجلسات واستخراج البيانات
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="aiApiKey" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              مفتاح API الأساسي (AI API Key)
              {tokenIsSet && (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold normal-case tracking-normal text-xs bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  ✔ محدَّد
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                id="aiApiKey"
                type={showToken ? 'text' : 'password'}
                placeholder={
                  tokenIsSet
                    ? `القيمة الحالية: ${maskedToken} — اتركه فارغاً للإبقاء عليها`
                    : 'gsk_... أو AIzaSy... أو sk-...'
                }
                value={form.aiApiKey}
                onChange={(e) => field('aiApiKey', e.target.value)}
                className="font-mono h-9 text-sm pe-10"
                dir="ltr"
                data-testid="input-ai-api-key"
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute inset-y-0 end-0 px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowToken((v) => !v)}
                tabIndex={-1}
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              يدعم مفاتيح: <strong>Groq (مجاني وفائق السرعة gsk_...)</strong>، <strong>Google Gemini (AIzaSy...)</strong>، أو <strong>OpenAI (sk-...)</strong>
            </p>
          </div>

          <SettingField
            id="aiModel"
            label="اسم النموذج (AI Model)"
            placeholder="llama-3.3-70b-versatile أو gemini-2.0-flash أو gpt-4o-mini"
            value={form.aiModel}
            onChange={(v) => field('aiModel', v)}
            mono
            dir="ltr"
            description="الافتراضي: llama-3.3-70b-versatile (سريع ودقيق جداً للغة العربية)"
            testId="input-ai-model"
          />

          <SettingField
            id="aiBaseUrl"
            label="رابط Base URL المخصص (اختياري)"
            placeholder="https://api.groq.com/openai/v1"
            value={form.aiBaseUrl}
            onChange={(v) => field('aiBaseUrl', v)}
            mono
            dir="ltr"
            description="اتركه فارغاً للاستخدام الافتراضي أو أدخل رابط مزود متوافق مع OpenAI"
            testId="input-ai-base-url"
          />
        </div>
      </div>

      {/* HuggingFace Fallback Card */}
      <div className="fade-in-up rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/40">
          <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
            <Settings2 className="w-4 h-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">نموذج احتياطي (Hugging Face Fallback)</p>
            <p className="text-xs text-muted-foreground">
              يُستخدم تلقائياً كبديل في حال تعذّر الاتصال بالنموذج الأساسي
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hfApiToken" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              رمز Hugging Face (API Token)
              {hfTokenIsSet && (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold normal-case tracking-normal text-xs bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  ✔ محدَّد
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                id="hfApiToken"
                type={showHfToken ? 'text' : 'password'}
                placeholder={
                  hfTokenIsSet
                    ? `القيمة الحالية: ${maskedHfToken} — اتركه فارغاً للإبقاء عليها`
                    : 'hf_...'
                }
                value={form.hfApiToken}
                onChange={(e) => field('hfApiToken', e.target.value)}
                className="font-mono h-9 text-sm pe-10"
                dir="ltr"
                data-testid="input-hf-api-token"
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute inset-y-0 end-0 px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowHfToken((v) => !v)}
                tabIndex={-1}
              >
                {showHfToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <SettingField
            id="hfModel"
            label="اسم نموذج Hugging Face"
            placeholder="meta-llama/Llama-3.1-8B-Instruct"
            value={form.hfModel}
            onChange={(v) => field('hfModel', v)}
            mono
            dir="ltr"
            testId="input-hf-model"
          />
        </div>
      </div>

      {/* Save Button */}
      <div className="fade-in-up flex items-center justify-end gap-3 pt-2">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="gap-2 px-6 h-10 text-sm font-semibold"
          data-testid="button-save-settings"
        >
          <Save className="w-4 h-4" />
          {saving ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}
        </Button>
      </div>
    </div>
  );
}
