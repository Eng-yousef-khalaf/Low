import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, Link } from 'wouter';
import {
  Briefcase,
  ArrowRight,
  Scale,
  Calendar,
  CheckSquare,
  Gavel,
  FileText,
  AlertTriangle,
  User,
  Building2,
  Clock,
  Coins,
  Plus,
  Edit,
  ExternalLink,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  FileCheck,
  History,
  ShieldCheck,
  Send,
  MessageSquare,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

export default function CaseDetailPage() {
  const [, params] = useRoute('/cases/:id');
  const caseId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAddSessionOpen, setIsAddSessionOpen] = useState(false);

  // Edit form state
  const [editStage, setEditStage] = useState('ابتدائية');
  const [editStatus, setEditStatus] = useState('active');
  const [editLawyer, setEditLawyer] = useState('');
  const [editCircuit, setEditCircuit] = useState('');
  const [editLastAction, setEditLastAction] = useState('');
  const [editRequiredAction, setEditRequiredAction] = useState('');
  const [editMissingDocs, setEditMissingDocs] = useState('');
  const [editTotalFees, setEditTotalFees] = useState('');
  const [editPaidFees, setEditPaidFees] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Fetch unified case profile
  const {
    data: caseData,
    isLoading,
    isError,
  } = useQuery<any>({
    queryKey: ['/api/cases', caseId],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}`);
      if (!res.ok) throw new Error('فشل جلب ملف القضية الموحد');
      return res.json();
    },
    enabled: !!caseId,
  });

  // Update case mutation
  const updateMutation = useMutation({
    mutationFn: async (updated: any) => {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل تحديث ملف القضية');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cases', caseId] });
      queryClient.invalidateQueries({ queryKey: ['/api/cases'] });
      toast({
        title: 'تم التحديث',
        description: 'تم تحديث ملف القضية الموحد بنجاح.',
      });
      setIsEditOpen(false);
    },
    onError: (err: any) => {
      toast({
        title: 'خطأ',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleOpenEdit = () => {
    if (!caseData) return;
    setEditStage(caseData.stage || 'ابتدائية');
    setEditStatus(caseData.status || 'active');
    setEditLawyer(caseData.assignedLawyer || '');
    setEditCircuit(caseData.circuit || '');
    setEditLastAction(caseData.lastAction || '');
    setEditRequiredAction(caseData.requiredAction || '');
    setEditMissingDocs((caseData.missingDocuments || []).join('\n'));
    setEditTotalFees(caseData.totalFees?.toString() || '');
    setEditPaidFees(caseData.paidFees?.toString() || '');
    setEditNotes(caseData.notes || '');
    setIsEditOpen(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const missingDocs = editMissingDocs
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    updateMutation.mutate({
      stage: editStage,
      status: editStatus,
      assignedLawyer: editLawyer,
      circuit: editCircuit,
      lastAction: editLastAction,
      requiredAction: editRequiredAction,
      missingDocuments: missingDocs,
      totalFees: editTotalFees ? parseFloat(editTotalFees) : 0,
      paidFees: editPaidFees ? parseFloat(editPaidFees) : 0,
      notes: editNotes,
    });
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">جاري تحميل ملف القضية الموحد...</p>
      </div>
    );
  }

  if (isError || !caseData) {
    return (
      <div className="p-8 max-w-xl mx-auto my-12 text-center bg-card rounded-2xl border border-border space-y-4">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
        <h2 className="text-lg font-bold">ملف القضية غير موجود أو تم حذفه</h2>
        <p className="text-xs text-muted-foreground">يرجى التأكد من الرقم أو العودة لقائمة القضايا.</p>
        <Link href="/cases">
          <Button variant="outline" className="text-xs gap-2">
            <ArrowRight className="w-3.5 h-3.5" />
            <span>العودة لقائمة القضايا</span>
          </Button>
        </Link>
      </div>
    );
  }

  const c = caseData;
  const client = caseData.client;
  const linkedSessions: any[] = caseData.linkedSessions || [];
  const linkedJudgments: any[] = caseData.linkedJudgments || [];
  const linkedTasks: any[] = caseData.linkedTasks || [];
  const timeline: any[] = caseData.timeline || [];
  const missingDocs: string[] = caseData.missingDocuments || [];

  const totalFees = c.totalFees || 0;
  const paidFees = c.paidFees || 0;
  const remainingFees = Math.max(0, totalFees - paidFees);
  const collectionRate = totalFees > 0 ? Math.round((paidFees / totalFees) * 100) : 0;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto" dir="rtl">
      {/* Back button & Action buttons */}
      <div className="flex items-center justify-between">
        <Link href="/cases">
          <Button variant="ghost" size="sm" className="gap-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowRight className="w-4 h-4" />
            <span>العودة لسجل القضايا</span>
          </Button>
        </Link>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleOpenEdit}
            className="text-xs gap-1.5"
            data-testid="button-edit-case"
          >
            <Edit className="w-3.5 h-3.5" />
            <span>تحديث بيانات الملف</span>
          </Button>

          <Link href={`/sessions?caseNumber=${c.courtCaseNumber}`}>
            <Button size="sm" className="text-xs gap-1.5 bg-primary text-primary-foreground shadow-sm">
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة جلسة للقضية</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Unified Header Card */}
      <Card className="shadow-sm border-border/80 overflow-hidden bg-card">
        <div className="h-3 bg-gradient-to-r from-primary via-amber-500 to-emerald-600" />
        <CardContent className="p-5 md:p-6 space-y-4">
          {/* Top Identifier Row */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-sm font-bold text-primary px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20">
                {c.internalNumber}
              </span>
              <span className="font-mono text-xs font-semibold text-muted-foreground bg-muted px-2 py-1 rounded-md">
                رقم ناجز: {c.courtCaseNumber}
              </span>
              <Badge variant="outline" className="text-xs font-semibold">
                مرحلة {c.stage}
              </Badge>
              <Badge
                variant={c.status === 'active' ? 'secondary' : 'outline'}
                className={`text-xs ${
                  c.status === 'active'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                    : ''
                }`}
              >
                {c.status === 'active'
                  ? 'نشطة وجارية'
                  : c.status === 'appealed'
                  ? 'مستأنفة'
                  : 'محكومة ومنتهية'}
              </Badge>
            </div>

            {c.filingDateHijri && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-mono">
                <Calendar className="w-3.5 h-3.5 text-primary" />
                <span>تاريخ القيد: {c.filingDateHijri} هـ</span>
              </div>
            )}
          </div>

          {/* Title */}
          <h1 className="text-xl md:text-2xl font-bold text-foreground leading-snug">
            {c.title}
          </h1>

          {/* Parties & Court Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 text-xs border-t border-border">
            <div className="p-2.5 rounded-xl bg-muted/40 space-y-1">
              <span className="text-muted-foreground text-[11px] block">الموكل (المدعي / المستأنف)</span>
              {client ? (
                <Link href={`/clients/${client.id}`}>
                  <span className="font-bold text-foreground hover:text-primary transition-colors cursor-pointer flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-primary" />
                    <span>{client.name}</span>
                  </span>
                </Link>
              ) : (
                <span className="font-bold text-foreground">{c.clientName}</span>
              )}
            </div>

            <div className="p-2.5 rounded-xl bg-muted/40 space-y-1">
              <span className="text-muted-foreground text-[11px] block">الخصم (المدعى عليه)</span>
              <span className="font-bold text-foreground block truncate">{c.opponentName}</span>
            </div>

            <div className="p-2.5 rounded-xl bg-muted/40 space-y-1">
              <span className="text-muted-foreground text-[11px] block">المحكمة والدائرة</span>
              <span className="font-bold text-foreground block truncate">
                {c.court} {c.circuit ? `(${c.circuit})` : ''}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-muted/40 space-y-1">
              <span className="text-muted-foreground text-[11px] block">المحامي المسؤول</span>
              <span className="font-bold text-foreground block">{c.assignedLawyer}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Urgency & Action Grid: Next Hearing, Last Action, Required Action, Missing Docs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Next Hearing & Actions Card */}
        <Card className="border-border/80 bg-card md:col-span-2 space-y-0">
          <CardHeader className="p-4 pb-2 border-b border-border/50">
            <CardTitle className="text-xs font-bold text-foreground flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-500" />
                <span>حالة الجلسة القادمة والإجراء المطلوب</span>
              </span>
              {c.nextHearing && (
                <span className="text-[11px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-md font-bold">
                  {c.nextHearing}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3 text-xs">
            {c.requiredAction && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-foreground space-y-1">
                <span className="font-bold text-amber-700 dark:text-amber-400 block text-[11px]">
                  ⚡ الإجراء المطلوب للمرافعة القادمة:
                </span>
                <p className="leading-relaxed">{c.requiredAction}</p>
              </div>
            )}

            {c.lastAction && (
              <div className="p-3 rounded-xl bg-muted/40 border border-border/60 text-muted-foreground space-y-1">
                <span className="font-semibold text-foreground block text-[11px]">
                  📌 آخر إجراء تم تنفيذه بالقضية:
                </span>
                <p className="leading-relaxed">{c.lastAction}</p>
              </div>
            )}

            {!c.requiredAction && !c.lastAction && (
              <p className="text-muted-foreground text-xs py-2">
                لا توجد إجراءات عاجلة مدونة حالياً. يمكنك تدوين الإجراءات عبر زر "تحديث بيانات الملف".
              </p>
            )}
          </CardContent>
        </Card>

        {/* Missing Documents Alert Box */}
        <Card className="border-border/80 bg-card">
          <CardHeader className="p-4 pb-2 border-b border-border/50">
            <CardTitle className="text-xs font-bold text-foreground flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                <span>نواقص المستندات</span>
              </span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {missingDocs.length} مستند
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 text-xs">
            {missingDocs.length === 0 ? (
              <div className="py-6 text-center space-y-1">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="font-semibold text-foreground text-xs">كافة المستندات مكتملة</p>
                <p className="text-[10px] text-muted-foreground">لا توجد نواقص إثبات أو بينات مطلوبة.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {missingDocs.map((doc, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-foreground flex items-start gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                    <span className="leading-tight text-[11px] font-medium">{doc}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Financial Overview Card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-border/80 bg-card p-3">
          <span className="text-[11px] text-muted-foreground">إجمالي أتعاب القضية</span>
          <div className="text-xl font-bold font-mono text-foreground mt-0.5">
            {totalFees.toLocaleString()} <span className="text-xs font-normal">ر.س</span>
          </div>
        </Card>

        <Card className="border-border/80 bg-card p-3">
          <span className="text-[11px] text-muted-foreground">المسدد فعلياً</span>
          <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
            {paidFees.toLocaleString()} <span className="text-xs font-normal">ر.س</span>
          </div>
        </Card>

        <Card className="border-border/80 bg-card p-3">
          <span className="text-[11px] text-muted-foreground">المتبقي للتحصيل</span>
          <div
            className={`text-xl font-bold font-mono mt-0.5 ${
              remainingFees > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600'
            }`}
          >
            {remainingFees.toLocaleString()} <span className="text-xs font-normal">ر.س</span>
          </div>
        </Card>

        <Card className="border-border/80 bg-card p-3">
          <span className="text-[11px] text-muted-foreground">نسبة التحصيل</span>
          <div className="flex items-center gap-2 mt-1">
            <Progress value={collectionRate} className="h-2 flex-1" />
            <span className="text-xs font-mono font-bold text-foreground">{collectionRate}%</span>
          </div>
        </Card>
      </div>

      {/* Unified Profile Tabs: Sessions, Tasks, Judgments, Timeline */}
      <Tabs defaultValue="sessions" className="space-y-4">
        <TabsList className="bg-muted/70 p-1">
          <TabsTrigger value="sessions" className="gap-2 text-xs">
            <Calendar className="w-3.5 h-3.5" />
            <span>الجلسات القضائية ({linkedSessions.length})</span>
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2 text-xs">
            <CheckSquare className="w-3.5 h-3.5" />
            <span>المهام والتكليفات ({linkedTasks.length})</span>
          </TabsTrigger>
          <TabsTrigger value="judgments" className="gap-2 text-xs">
            <Gavel className="w-3.5 h-3.5" />
            <span>الأحكام والقرارات ({linkedJudgments.length})</span>
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-2 text-xs">
            <History className="w-3.5 h-3.5" />
            <span>الخط الزمني الموحد للقضية ({timeline.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* Sessions Tab */}
        <TabsContent value="sessions" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-foreground">جلسات المرافعة المسجلة للقضية</h3>
            <Link href={`/sessions?caseNumber=${c.courtCaseNumber}`}>
              <Button size="sm" variant="outline" className="text-xs gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة جلسة جديدة</span>
              </Button>
            </Link>
          </div>

          {linkedSessions.length === 0 ? (
            <div className="py-12 text-center bg-card rounded-xl border border-dashed border-border p-6">
              <Calendar className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-semibold text-foreground">لا توجد جلسات مسجلة برقم القضية</p>
              <p className="text-xs text-muted-foreground mt-1">
                عند تحليل رسائل المحكمة أو إضافة جلسة برقم {c.courtCaseNumber}، ستظهر هنا تلقائياً.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {linkedSessions.map((session, idx) => (
                <Card key={idx} className="border-border/80 p-4 space-y-2 text-xs hover:border-primary/40 transition-colors">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-foreground">
                        جلسة: {session.sessionDateHijri || session.sessionDate || 'تاريخ غير محدد'}
                      </span>
                      {session.sessionTime && (
                        <span className="font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded text-[11px]">
                          {session.sessionTime}
                        </span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {session.status || 'مجدولة'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-muted-foreground">
                    <div>
                      <span>المحكمة والدائرة: </span>
                      <span className="text-foreground">{session.courtName || c.court}</span>
                    </div>
                    <div>
                      <span>المحامي الحاضر: </span>
                      <span className="text-foreground">{session.lawyerName || c.assignedLawyer}</span>
                    </div>
                  </div>

                  {session.judgeDecisionSummary && (
                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 text-foreground">
                      <span className="font-bold text-[11px] block text-primary">ما تم بالجلسة وقرار الدائرة:</span>
                      <p className="mt-0.5 leading-relaxed">{session.judgeDecisionSummary}</p>
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-end">
                    <Link href={`/reports/${session.id || session.rowNumber}`}>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-primary gap-1">
                        <span>تقرير الجلسة</span>
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-foreground">المهام والتكليفات المرتبطة للقضية</h3>
            <Link href="/tasks">
              <Button size="sm" variant="outline" className="text-xs gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة مهمة جديدة</span>
              </Button>
            </Link>
          </div>

          {linkedTasks.length === 0 ? (
            <div className="py-12 text-center bg-card rounded-xl border border-dashed border-border p-6">
              <CheckSquare className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-semibold text-foreground">لا توجد مهام مسندة لهذه القضية</p>
              <p className="text-xs text-muted-foreground mt-1">
                يمكنك تكليف المحامي أو المساعد القانوني بإعداد مذكرة، مراجعة المحكمة، أو استخراج صك.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {linkedTasks.map((t, idx) => (
                <Card key={idx} className="border-border/80 p-3.5 flex items-center justify-between text-xs">
                  <div className="space-y-1">
                    <h4 className="font-bold text-foreground text-sm">{t.title}</h4>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span>المكلف: {t.assignedTo || c.assignedLawyer}</span>
                      {t.dueDate && <span>الموعد النهائي: {t.dueDate}</span>}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {t.status || 'قيد الإجراء'}
                  </Badge>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Judgments Tab */}
        <TabsContent value="judgments" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-foreground">الأحكام والقرارات القضائية</h3>
            <Link href="/judgments">
              <Button size="sm" variant="outline" className="text-xs gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة حكم</span>
              </Button>
            </Link>
          </div>

          {linkedJudgments.length === 0 ? (
            <div className="py-12 text-center bg-card rounded-xl border border-dashed border-border p-6">
              <Gavel className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-semibold text-foreground">لم يصدر حكم قضائي نهائي بعد في القضية</p>
              <p className="text-xs text-muted-foreground mt-1">
                القضية ما زالت في مرحلة المرافعة وتقديم المذكرات.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {linkedJudgments.map((j, idx) => (
                <Card key={idx} className="border-border/80 p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-foreground">
                      صك حكم رقم: {j.judgmentNumber || j.id}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {j.status || 'منطوق الحكم'}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {j.summary || j.judgmentText || 'ملخص منطوق الحكم غير مدون'}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Unified Chronological Timeline Tab */}
        <TabsContent value="timeline">
          <Card className="border-border/80 bg-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-bold text-sm text-foreground">
                  الخط الزمني الموحد لمسار القضية
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  تتبع تسلسلي لكافة الجلسات، الأحكام، المهام، والإجراءات المتخذة بالقضية.
                </p>
              </div>
            </div>

            {timeline.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-xs">
                لا توجد أحداث مسجلة في الخط الزمني حتى الآن.
              </div>
            ) : (
              <div className="relative border-r-2 border-primary/30 mr-3 pr-5 space-y-6 pt-2">
                {timeline.map((event, idx) => {
                  const isSession = event.type === 'session';
                  const isJudgment = event.type === 'judgment';
                  const isTask = event.type === 'task';

                  return (
                    <div key={idx} className="relative group">
                      {/* Node Circle */}
                      <div
                        className={`absolute -right-[27px] top-0.5 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center ${
                          isJudgment
                            ? 'bg-amber-500 ring-2 ring-amber-500/20'
                            : isSession
                            ? 'bg-primary ring-2 ring-primary/20'
                            : 'bg-emerald-500 ring-2 ring-emerald-500/20'
                        }`}
                      />

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                            {event.date}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              isJudgment
                                ? 'text-amber-600 border-amber-300'
                                : isSession
                                ? 'text-primary border-primary/30'
                                : 'text-emerald-600 border-emerald-300'
                            }`}
                          >
                            {isJudgment ? 'حكم قضائي' : isSession ? 'جلسة مرافعة' : 'مهمة منجزة'}
                          </Badge>
                          {event.status && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {event.status}
                            </span>
                          )}
                        </div>

                        <h4 className="font-bold text-xs text-foreground">{event.title}</h4>

                        {event.description && (
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {event.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Case Modal */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">تحديث بيانات ملف القضية الموحد</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveEdit} className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">المرحلة الحالية</Label>
                <Select value={editStage} onValueChange={setEditStage}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="ابتدائية">ابتدائية</SelectItem>
                    <SelectItem value="استئناف">استئناف</SelectItem>
                    <SelectItem value="تنفيذ">تنفيذ</SelectItem>
                    <SelectItem value="عليا">المحكمة العليا</SelectItem>
                    <SelectItem value="صلح وتسوية">صلح وتسوية</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">حالة القضية</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="active">جارية</SelectItem>
                    <SelectItem value="appealed">مستأنفة</SelectItem>
                    <SelectItem value="closed">منتهية ومحكومة</SelectItem>
                    <SelectItem value="suspended">موقوفة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">المحامي المسؤول</Label>
                <Input
                  value={editLawyer}
                  onChange={(e) => setEditLawyer(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">الدائرة القضائية</Label>
                <Input
                  value={editCircuit}
                  onChange={(e) => setEditCircuit(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">الإجراء المطلوب للمرافعة القادمة</Label>
              <Textarea
                value={editRequiredAction}
                onChange={(e) => setEditRequiredAction(e.target.value)}
                placeholder="تجهيز مذكرة جوابية، إحضار شهود، استخراج بينة..."
                className="text-xs min-h-[50px]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">آخر إجراء تم تنفيذه</Label>
              <Textarea
                value={editLastAction}
                onChange={(e) => setEditLastAction(e.target.value)}
                placeholder="تقديم اللائحة عبر ناجز، دفع الرسوم..."
                className="text-xs min-h-[50px]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-amber-600">نواقص المستندات (مستند في كل سطر)</Label>
              <Textarea
                value={editMissingDocs}
                onChange={(e) => setEditMissingDocs(e.target.value)}
                className="text-xs min-h-[60px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">إجمالي الأتعاب (ر.س)</Label>
                <Input
                  type="number"
                  value={editTotalFees}
                  onChange={(e) => setEditTotalFees(e.target.value)}
                  className="text-xs font-mono text-left"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">المسدد فعلياً (ر.س)</Label>
                <Input
                  type="number"
                  value={editPaidFees}
                  onChange={(e) => setEditPaidFees(e.target.value)}
                  className="text-xs font-mono text-left"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">ملاحظات عامة</Label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="text-xs min-h-[50px]"
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditOpen(false)}
                className="text-xs"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                className="text-xs bg-primary text-primary-foreground"
              >
                {updateMutation.isPending ? 'جاري الحفظ...' : 'حفظ التحديثات'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
