import { useState } from 'react';
import { useAnalyzeMessage, useCreateSession, useGetCurrentUser, getListSessionsQueryKey, getGetDashboardStatsQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, Save, RotateCcw, CheckCircle2, ArrowLeft, Bot, AlertTriangle, AlertCircle, ShieldCheck, Database } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';

export default function ChatPage() {
  const [message, setMessage] = useState('');
  const [extractedData, setExtractedData] = useState<any>(null);
  const [formData, setFormData] = useState<any>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: currentUser, refetch: refetchUser } = useGetCurrentUser();
  const user = currentUser as any;
  const isExpired = Boolean(user?.isExpired || user?.isSuspended);
  const isQuotaExceeded = user?.role !== 'admin' && user?.ai_quota_limit !== -1 && (user?.ai_usage_count || 0) >= (user?.ai_quota_limit || 50);

  const analyzeMutation = useAnalyzeMessage();
  const createMutation = useCreateSession();

  const handleAnalyze = () => {
    if (isExpired) {
      toast({
        title: 'الاشتراك غير سارٍ',
        description: 'انتهت صلاحية اشتراكك. يرجى التواصل مع المشرف العام لتجديد الاشتراك واستئناف التحليل.',
        variant: 'destructive',
      });
      return;
    }
    if (isQuotaExceeded) {
      toast({
        title: 'تم استهلاك رصيد الذكاء الاصطناعي',
        description: 'وصلت إلى الحد الأقصى لتحليلات الرسائل لباقة اشتراكك لهذا الشهر. يرجى مراجعة الإدارة للترقية أو إعادة الشحن.',
        variant: 'destructive',
      });
      return;
    }
    if (!message.trim()) {
      toast({
        title: 'تنبيه',
        description: 'يرجى إدخال نص الرسالة أولاً',
        variant: 'destructive',
      });
      return;
    }

    analyzeMutation.mutate(
      { data: { message } },
      {
        onSuccess: (data: any) => {
          setExtractedData(data);
          setFormData({
            caseNumber: data.case_number || '',
            plaintiff: data.plaintiff || '',
            defendant: data.defendant || '',
            court: data.court || '',
            courtCircuit: data.court_circuit || '',
            caseSubject: data.case_subject || '',
            sessionType: data.session_type || '',
            sessionDateHijri: data.session_date_hijri || '',
            sessionTime: data.session_time || '',
            notes: data.notes || '',
          });
          refetchUser();
          toast({
            title: 'تم التحليل بنجاح',
            description: 'تم استخراج بيانات الجلسة. راجعها وعدّلها قبل الحفظ.',
          });
        },
        onError: (error: any) => {
          setExtractedData(null);
          setFormData({});
          toast({
            title: 'لا توجد بيانات جلسة كافية',
            description: error?.message || 'لا توجد بيانات جلسة كافية في النص المدخل. يرجى التأكد من إدخال نص إشعار جلسة قضائية صالح.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const isSessionSavable = Boolean(
    formData.caseNumber?.trim() &&
    formData.court?.trim() &&
    formData.sessionDateHijri?.trim()
  );

  const handleSave = () => {
    if (!isSessionSavable) {
      toast({
        title: 'بيانات الجلسة غير مكتملة',
        description: 'يرجى تعبئة الحقول الأساسية: رقم القضية، المحكمة، وتاريخ الجلسة.',
        variant: 'destructive',
      });
      return;
    }

    createMutation.mutate(
      { data: formData },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
          toast({
            title: 'تم الحفظ',
            description: 'تم حفظ جلسة المحكمة بنجاح في Google Drive Sheets',
          });
          setMessage('');
          setExtractedData(null);
          setFormData({});
          setLocation('/sessions');
        },
        onError: (error: any) => {
          toast({
            title: 'فشل الحفظ',
            description: error?.message || 'تعذّر حفظ الجلسة',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleReset = () => {
    setMessage('');
    setExtractedData(null);
    setFormData({});
  };

  const updateField = (field: string, value: string) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const fields = [
    { key: 'caseNumber', label: 'رقم القضية', dir: 'ltr' as const, mono: true, required: true },
    { key: 'court', label: 'المحكمة', dir: 'rtl' as const, required: true },
    { key: 'plaintiff', label: 'المدّعي', dir: 'rtl' as const },
    { key: 'defendant', label: 'المدّعى عليه', dir: 'rtl' as const },
    { key: 'courtCircuit', label: 'الدائرة القضائية', dir: 'rtl' as const },
    { key: 'caseSubject', label: 'موضوع القضية', dir: 'rtl' as const },
    { key: 'sessionType', label: 'نوع الجلسة', dir: 'rtl' as const },
    { key: 'sessionDateHijri', label: 'تاريخ الجلسة (ميلادي / هجري)', dir: 'ltr' as const, mono: true, required: true },
    { key: 'sessionTime', label: 'وقت الجلسة', dir: 'auto' as const, mono: true },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="fade-in-up flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-6 rounded-full bg-primary" />
            <h1 className="text-2xl font-bold tracking-tight">تحليل رسالة المحكمة بالذكاء الاصطناعي</h1>
          </div>
          <p className="text-muted-foreground text-sm mr-3">
            الصق نص إشعار الجلسة ليتم تحليلها فوراً واستخراج الأطراف والمحكمة والمواعيد
          </p>
        </div>

        {/* User AI Quota Card */}
        {user && (
          <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/60 shadow-xs">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="text-xs space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">
                  {user.plan_tier === 'pro' ? 'باقة برو (Pro)' : 'باقة بلس (Plus)'}
                </span>
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                  {user.billing_cycle === 'monthly' ? 'شهري' : 'سنوي'}
                </Badge>
              </div>
              <p className="text-muted-foreground text-[11px]">
                رصيد التحليل: <strong className="font-mono text-foreground">{user.role === 'admin' ? 'مفتوح (مشرف)' : `${user.ai_usage_count || 0} / ${user.ai_quota_limit || 50}`}</strong>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Expiration or Quota Warnings */}
      {isExpired && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-center gap-3 text-red-700 dark:text-red-300">
          <AlertTriangle className="w-5 h-5 shrink-0 animate-pulse text-red-600" />
          <div className="text-xs">
            <p className="font-bold">تم إيقاف الخدمة: اشتراكك منتهٍ أو موقوف مؤقتاً</p>
            <p className="text-muted-foreground mt-0.5">
              تم إيقاف عمل تحليلات الذكاء الاصطناعي وحفظ التقارير والاتصال بجداول الإكسل. يرجى التواصل مع المشرف العام لتجديد الاشتراك.
            </p>
          </div>
        </div>
      )}

      {!isExpired && isQuotaExceeded && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-center gap-3 text-amber-800 dark:text-amber-300">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
          <div className="text-xs">
            <p className="font-bold">تم استهلاك رصيد تحليلات الذكاء الاصطناعي لهذا الشهر ({user?.ai_usage_count}/{user?.ai_quota_limit})</p>
            <p className="text-muted-foreground mt-0.5">
              كل مستخدم يمتلك رصيداً مستقلاً. يرجى التواصل مع المشرف العام لتصفير الرصيد أو الترقية لباقة برو (Pro).
            </p>
          </div>
        </div>
      )}

      {/* Message Input Card */}
      <div className="fade-in-up fade-in-up-delay-1 rounded-xl border border-border bg-card overflow-hidden">
        {/* Card Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/30">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">نص الرسالة القضائية</p>
            <p className="text-xs text-muted-foreground">يعمل التحليل عبر حساب الذكاء الاصطناعي المركزي للمدير مع عزل رصيدك</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <Textarea
            placeholder="الصق نص رسالة المحكمة هنا..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            disabled={analyzeMutation.isPending || isExpired || isQuotaExceeded}
            className="text-base resize-none leading-relaxed border-border/50 focus:border-primary/50 bg-background/50"
            dir="auto"
            data-testid="textarea-message"
          />
          <div className="flex gap-2">
            <Button
              onClick={handleAnalyze}
              disabled={analyzeMutation.isPending || !message.trim() || isExpired || isQuotaExceeded}
              className="gap-2 shadow-sm font-bold"
              data-testid="button-analyze"
            >
              <Sparkles className="w-4 h-4" />
              {analyzeMutation.isPending ? 'جارٍ التحليل...' : 'تحليل بالذكاء الاصطناعي'}
            </Button>
            {extractedData && (
              <Button
                onClick={handleReset}
                variant="outline"
                className="gap-2"
                data-testid="button-reset"
              >
                <RotateCcw className="w-4 h-4" />
                إعادة تعيين
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Success Alert */}
      {extractedData && (
        <div className="fade-in-up rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">تم استخراج البيانات بنجاح</p>
            <p className="text-xs text-emerald-600/80 dark:text-emerald-500/80 mt-0.5">
              راجع الحقول أدناه وعدّلها إن لزم، ثم اضغط زر الحفظ
            </p>
          </div>
        </div>
      )}

      {/* Extracted Data Form */}
      {extractedData && (
        <div className="fade-in-up rounded-xl border border-primary/20 bg-card overflow-hidden shadow-sm">
          {/* Form Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-primary/3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <ArrowLeft className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">البيانات المستخرجة</p>
              <p className="text-xs text-muted-foreground">راجع الحقول وعدّلها إن لزم</p>
            </div>
          </div>

          <div className="p-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={f.key} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <span>{f.label}</span>
                    {f.required && <span className="text-destructive font-bold">*</span>}
                  </Label>
                  <Input
                    id={f.key}
                    value={formData[f.key] || ''}
                    onChange={(e) => updateField(f.key, e.target.value)}
                    className={`${f.mono ? 'font-mono' : ''} h-9 text-sm ${f.required && !formData[f.key]?.trim() ? 'border-amber-500/40' : ''}`}
                    dir={f.dir}
                    required={f.required}
                    onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity('يرجى تعبئة هذا الحقل')}
                    onInput={(e) => (e.target as HTMLInputElement).setCustomValidity('')}
                    data-testid={`input-${f.key}`}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                ملاحظات
              </Label>
              <Textarea
                id="notes"
                value={formData.notes || ''}
                onChange={(e) => updateField('notes', e.target.value)}
                rows={3}
                dir="auto"
                className="resize-none text-sm"
                data-testid="textarea-notes"
              />
            </div>

            <div className="space-y-2 pt-2">
              <Button
                onClick={handleSave}
                disabled={createMutation.isPending || !isSessionSavable}
                size="lg"
                className="w-full gap-2 text-base font-bold h-12 shadow-sm cursor-pointer disabled:cursor-not-allowed"
                data-testid="button-save"
              >
                <Save className="w-5 h-5" />
                {createMutation.isPending ? 'جارٍ الحفظ في Google Sheets...' : 'حفظ الجلسة في Google Sheets'}
              </Button>
              {!isSessionSavable && (
                <p className="text-xs text-amber-600 dark:text-amber-400 text-center font-medium">
                  ⚠️ الحقول المشار إليها بعلامة (*) إلزامية لتفعيل حفظ الجلسة (رقم القضية، المحكمة، وتاريخ الجلسة).
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
