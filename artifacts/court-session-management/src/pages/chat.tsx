import { useState } from 'react';
import { useAnalyzeMessage, useCreateSession, useGetCurrentUser, getListSessionsQueryKey, getGetDashboardStatsQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Sparkles,
  Save,
  RotateCcw,
  CheckCircle2,
  ArrowLeft,
  Bot,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Calendar,
  FileText,
  HelpCircle,
  Check,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { validateDateInput, normalizeArabicNumerals, type CalendarType } from '@/lib/date-validation';
import { TeamMemberSelect } from '@/components/team-select';

export default function ChatPage() {
  const [message, setMessage] = useState('');
  const [calendarType, setCalendarType] = useState<CalendarType>('hijri');
  const [extractedData, setExtractedData] = useState<any>(null);
  const [formData, setFormData] = useState<any>({});
  const [lastError, setLastError] = useState<{ message: string; refCode?: string; isInsufficient?: boolean } | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: currentUser, refetch: refetchUser } = useGetCurrentUser();
  const user = currentUser as any;
  const isExpired = Boolean(user?.isExpired || user?.isSuspended);
  const isQuotaExceeded = user?.role !== 'admin' && user?.ai_quota_limit !== -1 && (user?.ai_usage_count || 0) >= (user?.ai_quota_limit || 50);

  const analyzeMutation = useAnalyzeMessage();
  const createMutation = useCreateSession();

  // Validate the session date based on selected calendar type
  const dateValidation = formData.sessionDateHijri
    ? validateDateInput(formData.sessionDateHijri, calendarType)
    : { isValid: true };

  const isSessionSavable = Boolean(
    formData.caseNumber?.trim() &&
    formData.court?.trim() &&
    formData.sessionDateHijri?.trim() &&
    dateValidation.isValid
  );

  const handleAnalyze = () => {
    setLastError(null);

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
          setLastError(null);
          setExtractedData(data);

          // Detect if date returned looks Gregorian (e.g. 2026/...)
          if (data.session_date_hijri && data.session_date_hijri.startsWith('20')) {
            setCalendarType('gregorian');
          } else {
            setCalendarType('hijri');
          }

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
            title: 'تم استخراج البيانات بنجاح',
            description: 'تم استخراج تفاصيل الجلسة. يمكنك مطابقتها مع النص وتعديلها قبل الحفظ.',
          });
        },
        onError: (error: any) => {
          // Extract structured server error (supports both ApiError.data and axios-like response.data)
          const resData = (error?.data && typeof error.data === 'object' ? error.data : error?.response?.data) || {};
          const status = Number(error?.status || error?.response?.status || 500);
          const isInsufficient =
            Boolean(resData.isInsufficientData) ||
            resData.code === 'VALIDATION_ERROR' ||
            status === 400 ||
            status === 422;
          const isQuotaOrSub =
            status === 403 ||
            Boolean(resData.isQuotaExceeded) ||
            resData.code === 'AI_QUOTA_EXCEEDED' ||
            resData.code === 'SUBSCRIPTION_INACTIVE';
          const refCode = resData.referenceCode;

          let displayMsg = 'تعذر تحليل الرسالة حالياً، يرجى المحاولة مرة أخرى أو إدخال البيانات يدوياً.';
          if (isInsufficient) {
            displayMsg =
              resData.error ||
              'النص المدخل لا يبدو إشعار جلسة قضائية أو يفتقر لرقم القضية والمحكمة والتاريخ. لم يتم خصم أي رصيد.';
          } else if (isQuotaOrSub) {
            displayMsg = resData.error || 'تم استهلاك الرصيد المخصص لحسابك لهذا الشهر أو انتهت صلاحية الاشتراك.';
            refetchUser();
          } else if (status === 429) {
            displayMsg = resData.error || 'طلبات متتالية بسرعة عالية. يرجى الانتظار بضع ثوانٍ ثم إعادة المحاولة.';
          } else if (status >= 500) {
            displayMsg =
              resData.error ||
              'خدمة التحليل غير متاحة مؤقتاً. لم يتم خصم أي رصيد، يمكنك المحاولة مجدداً أو إضافة الجلسة يدوياً.';
          } else if (resData.error) {
            displayMsg = resData.error;
          }

          setLastError({
            message: displayMsg,
            refCode,
            isInsufficient,
          });

          toast({
            title: isInsufficient
              ? 'النص لا يحتوي على بيانات جلسة كافية'
              : isQuotaOrSub
                ? 'تنبيه الرصيد / الاشتراك'
                : status >= 500
                  ? 'خدمة التحليل غير متاحة مؤقتاً'
                  : 'تعذر إتمام التحليل',
            description: displayMsg + (refCode ? ` (المرجع: ${refCode})` : ''),
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleSave = () => {
    if (!formData.caseNumber?.trim() || !formData.court?.trim() || !formData.sessionDateHijri?.trim()) {
      toast({
        title: 'بيانات الجلسة غير مكتملة',
        description: 'يرجى تعبئة الحقول الأساسية: رقم القضية، المحكمة، وتاريخ الجلسة.',
        variant: 'destructive',
      });
      return;
    }

    if (!dateValidation.isValid) {
      toast({
        title: 'تاريخ غير صالح',
        description: dateValidation.message || 'يرجى تصحيح تاريخ الجلسة قبل الحفظ.',
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
            title: 'تم الحفظ بنجاح',
            description: 'تم تسجيل جلسة المحكمة في النظام.',
          });
          setMessage('');
          setExtractedData(null);
          setFormData({});
          setLocation('/sessions');
        },
        onError: (error: any) => {
          toast({
            title: 'فشل الحفظ',
            description: error?.message || 'تعذّر حفظ الجلسة في قاعدة البيانات',
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
    setLastError(null);
  };

  const updateField = (field: string, value: string) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="fade-in-up flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 rounded-full bg-primary" />
            <h1 className="text-2xl font-bold tracking-tight">تحليل رسائل المحاكم الذكي</h1>
          </div>
          <p className="text-muted-foreground text-sm mr-3">
            الصق نص إشعار الجلسة القضائي لاستخراج أطراف الدعوى، المحكمة، التاريخ والوقت تلقائياً
          </p>
        </div>

        {/* User AI Quota Card */}
        {user && (
          <div className="flex items-center gap-3 p-3.5 rounded-2xl border border-border bg-card/80 shadow-xs">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="text-xs space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">
                  {user.plan_tier === 'pro' ? 'باقة برو (Pro)' : 'باقة بلس (Plus)'}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-semibold border border-amber-500/20">
                  {user.billing_cycle === 'monthly' ? 'شهري' : 'سنوي'}
                </span>
              </div>
              <p className="text-muted-foreground text-[11px]">
                رصيد التحليل: <strong className="font-mono text-foreground font-bold">{user.role === 'admin' ? 'مفتوح (مشرف)' : `${user.ai_usage_count || 0} من ${user.ai_quota_limit || 50}`}</strong>
              </p>
              <p className="text-[10px] text-muted-foreground">
                يتجدد في: <span className="font-semibold text-foreground">{user.ai_renewal_date || 'بداية الشهر القادم'}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Quota Policy Note */}
      <div className="rounded-xl border border-primary/10 bg-primary/5 px-4 py-2.5 text-xs text-muted-foreground flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-primary shrink-0" />
          <span>
            <strong>سياسة الرصيد:</strong> يُخصم الرصيد فقط عند اكتمال التحليل بنجاح. لا يُخصم أي رصيد عند فشل الخدمة أو عند إعادة المحاولة.
          </span>
        </div>
      </div>

      {/* Expiration or Quota Warnings */}
      {isExpired && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 flex items-center gap-3 text-red-700 dark:text-red-300">
          <AlertTriangle className="w-5 h-5 shrink-0 animate-pulse text-red-600" />
          <div className="text-xs">
            <p className="font-bold">تم إيقاف الخدمة: اشتراكك منتهٍ أو موقوف مؤقتاً</p>
            <p className="text-muted-foreground mt-0.5">
              تم إيقاف تحليلات الذكاء الاصطناعي لحين تجديد الاشتراك. يرجى التواصل مع المشرف العام.
            </p>
          </div>
        </div>
      )}

      {/* Error Banner with Retry */}
      {lastError && (
        <div className="fade-in-up rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold text-sm">
                {lastError.isInsufficient ? 'نص الرسالة غير كافٍ للتحليل' : 'تعذر إتمام تحليل الرسالة حالياً'}
              </p>
              <p className="text-muted-foreground leading-relaxed">
                {lastError.message}
              </p>
              {lastError.refCode && (
                <p className="font-mono text-[11px] text-muted-foreground pt-1">
                  الرقم المرجعي لمتابعة الخطأ: <span className="font-bold text-foreground">{lastError.refCode}</span>
                </p>
              )}
            </div>
          </div>
          <Button
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending}
            variant="outline"
            size="sm"
            className="gap-2 shrink-0 border-amber-500/40 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* Message Input Section */}
      <div className="fade-in-up fade-in-up-delay-1 rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/30">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">نص الرسالة القضائية</p>
            <p className="text-xs text-muted-foreground">يمكنك لصق الرسالة كما وردت من المحكمة (SMS أو بريد)</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <Textarea
            placeholder="الصق نص رسالة المحكمة هنا (مثال: موعد جلسة في القضية رقم 1446/25 لدى المحكمة العامة بالرياض بتاريخ 15/02/1448 الساعة 10:00 صباحاً)..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            disabled={analyzeMutation.isPending || isExpired || isQuotaExceeded}
            className="text-sm resize-none leading-relaxed border-border/70 focus:border-primary bg-background/50"
            dir="auto"
            data-testid="textarea-message"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={handleAnalyze}
              disabled={analyzeMutation.isPending || !message.trim() || isExpired || isQuotaExceeded}
              className="gap-2 font-bold shadow-sm"
              data-testid="button-analyze"
            >
              <Sparkles className="w-4 h-4" />
              {analyzeMutation.isPending ? 'جارٍ تحليل النص...' : 'بدء التحليل بالذكاء الاصطناعي'}
            </Button>
            {extractedData && (
              <Button
                onClick={handleReset}
                variant="outline"
                className="gap-2 text-xs"
                data-testid="button-reset"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                إلغاء والبدء من جديد
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Review & Cross-Check Section (Point 26) */}
      {extractedData && (
        <div className="fade-in-up space-y-4">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/8 p-4 flex items-center justify-between gap-3 text-emerald-900 dark:text-emerald-200">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-bold">تم استخراج بيانات الجلسة بنجاح</p>
                <p className="text-xs text-muted-foreground">
                  طابق النص الأصلي مع الحقول المستخرجة أدناه وعدّلها حسب الحاجة قبل الحفظ
                </p>
              </div>
            </div>
            {extractedData.source === 'ai' ? (
              <Badge className="bg-primary/15 text-primary border-primary/30 text-xs">
                استخراج الذكاء الاصطناعي
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                استخراج القواعد الذكية
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Original Message Reference (Point 26) */}
            <div className="lg:col-span-1 rounded-2xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border pb-2.5">
                <FileText className="w-4 h-4 text-primary" />
                <span>النص الأصلي للرسالة</span>
              </h3>
              <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 text-xs leading-relaxed text-foreground whitespace-pre-wrap font-sans">
                {message}
              </div>
              <p className="text-[11px] text-muted-foreground">
                قارن القيم المستخرجة بالنص أعلاه للتأكد من دقة أرقام الدعوى والمواعيد.
              </p>
            </div>

            {/* Right: Extracted Editable Fields (2 cols) */}
            <div className="lg:col-span-2 rounded-2xl border border-primary/20 bg-card p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <ArrowLeft className="w-4 h-4 text-primary" />
                  <span>مراجعة وتعديل بيانات الجلسة</span>
                </h3>

                {/* Calendar Type Toggle (Point 5) */}
                <div className="flex items-center gap-2 bg-muted/60 p-1 rounded-xl border border-border text-xs">
                  <button
                    type="button"
                    onClick={() => setCalendarType('hijri')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      calendarType === 'hijri'
                        ? 'bg-primary text-white shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    هجري (Hijri)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarType('gregorian')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      calendarType === 'gregorian'
                        ? 'bg-primary text-white shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    ميلادي (Gregorian)
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Case Number */}
                <div className="space-y-1.5">
                  <Label htmlFor="caseNumber" className="text-xs font-semibold flex items-center justify-between">
                    <span>رقم القضية *</span>
                    {!formData.caseNumber?.trim() && (
                      <span className="text-[10px] text-amber-500 font-normal">يحتاج مراجعة</span>
                    )}
                  </Label>
                  <Input
                    id="caseNumber"
                    value={formData.caseNumber || ''}
                    onChange={(e) => updateField('caseNumber', e.target.value)}
                    placeholder="مثال: 1446/256"
                    className="h-9 font-mono text-xs"
                    dir="ltr"
                    required
                  />
                </div>

                {/* Court */}
                <div className="space-y-1.5">
                  <Label htmlFor="court" className="text-xs font-semibold flex items-center justify-between">
                    <span>المحكمة *</span>
                    {!formData.court?.trim() && (
                      <span className="text-[10px] text-amber-500 font-normal">يحتاج مراجعة</span>
                    )}
                  </Label>
                  <Input
                    id="court"
                    value={formData.court || ''}
                    onChange={(e) => updateField('court', e.target.value)}
                    placeholder="مثال: المحكمة العامة بالرياض"
                    className="h-9 text-xs"
                    dir="rtl"
                    required
                  />
                </div>

                {/* Plaintiff */}
                <div className="space-y-1.5">
                  <Label htmlFor="plaintiff" className="text-xs font-semibold">
                    المدّعي (الموكل)
                  </Label>
                  <Input
                    id="plaintiff"
                    value={formData.plaintiff || ''}
                    onChange={(e) => updateField('plaintiff', e.target.value)}
                    placeholder="اسم المدعي..."
                    className="h-9 text-xs"
                    dir="rtl"
                  />
                </div>

                {/* Defendant */}
                <div className="space-y-1.5">
                  <Label htmlFor="defendant" className="text-xs font-semibold">
                    المدّعى عليه (الخصم)
                  </Label>
                  <Input
                    id="defendant"
                    value={formData.defendant || ''}
                    onChange={(e) => updateField('defendant', e.target.value)}
                    placeholder="اسم المدعى عليه..."
                    className="h-9 text-xs"
                    dir="rtl"
                  />
                </div>

                {/* Court Circuit */}
                <div className="space-y-1.5">
                  <Label htmlFor="courtCircuit" className="text-xs font-semibold">
                    الدائرة القضائية
                  </Label>
                  <Input
                    id="courtCircuit"
                    value={formData.courtCircuit || ''}
                    onChange={(e) => updateField('courtCircuit', e.target.value)}
                    placeholder="مثال: الدائرة الحقوقية الثالثة"
                    className="h-9 text-xs"
                    dir="rtl"
                  />
                </div>

                {/* Session Type */}
                <div className="space-y-1.5">
                  <Label htmlFor="sessionType" className="text-xs font-semibold">
                    نوع الجلسة
                  </Label>
                  <Input
                    id="sessionType"
                    value={formData.sessionType || ''}
                    onChange={(e) => updateField('sessionType', e.target.value)}
                    placeholder="مرافعة / استماع / نطق بالحكم..."
                    className="h-9 text-xs"
                    dir="rtl"
                  />
                </div>

                {/* Session Date with live validation & format indicator (Point 5) */}
                <div className="space-y-1.5">
                  <Label htmlFor="sessionDateHijri" className="text-xs font-semibold flex items-center justify-between">
                    <span>
                      تاريخ الجلسة ({calendarType === 'hijri' ? 'هجري' : 'ميلادي'}) *
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {calendarType === 'hijri' ? 'يوم/شهر/سنة (مثال: 15/02/1448)' : 'يوم/شهر/سنة (مثال: 25/10/2026)'}
                    </span>
                  </Label>
                  <Input
                    id="sessionDateHijri"
                    value={formData.sessionDateHijri || ''}
                    onChange={(e) => updateField('sessionDateHijri', e.target.value)}
                    placeholder={calendarType === 'hijri' ? '15/02/1448' : '25/10/2026'}
                    className={`h-9 font-mono text-xs ${
                      !dateValidation.isValid ? 'border-destructive focus:border-destructive' : ''
                    }`}
                    dir="ltr"
                    required
                  />
                  {!dateValidation.isValid && (
                    <p className="text-[11px] text-destructive font-semibold flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{dateValidation.message}</span>
                    </p>
                  )}
                </div>

                {/* Session Time */}
                <div className="space-y-1.5">
                  <Label htmlFor="sessionTime" className="text-xs font-semibold">
                    وقت الجلسة
                  </Label>
                  <Input
                    id="sessionTime"
                    value={formData.sessionTime || ''}
                    onChange={(e) => updateField('sessionTime', normalizeArabicNumerals(e.target.value))}
                    placeholder="10:30 صباحاً"
                    className="h-9 font-mono text-xs"
                    dir="auto"
                  />
                </div>

                {/* Assigned Lawyer from Team */}
                <div className="sm:col-span-2">
                  <TeamMemberSelect
                    id="assignedLawyer"
                    label="المحامي المكلف بحضور الجلسة"
                    value={formData.assignedLawyer || ''}
                    assigneeId={formData.assigneeId || null}
                    onChange={(name, memberId) => {
                      setFormData((prev: any) => ({
                        ...prev,
                        assignedLawyer: name,
                        assigneeId: memberId || null,
                      }));
                    }}
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-xs font-semibold">
                  ملاحظات
                </Label>
                <Textarea
                  id="notes"
                  value={formData.notes || ''}
                  onChange={(e) => updateField('notes', e.target.value)}
                  rows={2}
                  dir="auto"
                  className="resize-none text-xs"
                />
              </div>

              {/* Save Button */}
              <div className="pt-2 space-y-2">
                <Button
                  onClick={handleSave}
                  disabled={createMutation.isPending || !isSessionSavable}
                  size="lg"
                  className="w-full gap-2 text-sm font-bold h-11 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="button-save"
                >
                  <Save className="w-4 h-4" />
                  {createMutation.isPending ? 'جارٍ حفظ الجلسة...' : 'حفظ واعتماد الجلسة'}
                </Button>

                {!isSessionSavable && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 text-center font-medium">
                    ⚠️ الحقول المشار إليها بعلامة (*) إلزامية لحفظ الجلسة (رقم القضية، المحكمة، وتاريخ الجلسة بصيغة صحيحة).
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
