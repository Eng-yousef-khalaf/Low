import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, Link } from 'wouter';
import {
  Users,
  Building2,
  User,
  ArrowRight,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  ShieldCheck,
  Coins,
  Edit,
  Plus,
  MessageCircle,
  Copy,
  Calendar,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Scale,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

export default function ClientDetailPage() {
  const [, params] = useRoute('/clients/:id');
  const clientId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAddCaseOpen, setIsAddCaseOpen] = useState(false);

  // Edit form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [notes, setNotes] = useState('');

  // Fetch client full profile
  const {
    data: clientData,
    isLoading,
    isError,
  } = useQuery<any>({
    queryKey: ['/api/clients', clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}`);
      if (!res.ok) throw new Error('فشل جلب ملف العميل');
      return res.json();
    },
    enabled: !!clientId,
  });

  // Update client mutation
  const updateMutation = useMutation({
    mutationFn: async (updated: any) => {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل تحديث بيانات العميل');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients', clientId] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      toast({
        title: 'تم التحديث',
        description: 'تم تحديث بيانات العميل بنجاح.',
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

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      name,
      phone,
      email,
      address,
      contactPerson,
      notes,
    });
  };

  const openEditModal = () => {
    if (!clientData) return;
    setName(clientData.name || '');
    setPhone(clientData.phone || '');
    setEmail(clientData.email || '');
    setAddress(clientData.address || '');
    setContactPerson(clientData.contactPerson || '');
    setNotes(clientData.notes || '');
    setIsEditOpen(true);
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">جاري تحميل ملف العميل الشامل...</p>
      </div>
    );
  }

  if (isError || !clientData) {
    return (
      <div className="p-8 max-w-xl mx-auto my-12 text-center bg-card rounded-2xl border border-border space-y-4">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
        <h2 className="text-lg font-bold">ملف العميل غير موجود أو تم نقله</h2>
        <p className="text-xs text-muted-foreground">تأكد من صحة الرابط أو عُد لقائمة العملاء.</p>
        <Link href="/clients">
          <Button variant="outline" className="text-xs gap-2">
            <ArrowRight className="w-3.5 h-3.5" />
            <span>العودة لقائمة العملاء</span>
          </Button>
        </Link>
      </div>
    );
  }

  const client = clientData;
  const linkedCases: any[] = clientData.linkedCases || [];
  const linkedPoas: any[] = clientData.linkedPoas || [];
  const financialSummary = clientData.financialSummary || {
    totalFees: 0,
    paidFees: 0,
    remainingFees: 0,
    collectionRate: 0,
  };

  const waNumber = client.phone ? client.phone.replace(/[^0-9]/g, '') : '';

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto" dir="rtl">
      {/* Back Link & Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/clients">
          <Button variant="ghost" size="sm" className="gap-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowRight className="w-4 h-4" />
            <span>العودة لسجل العملاء</span>
          </Button>
        </Link>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={openEditModal}
            className="text-xs gap-1.5"
            data-testid="button-edit-client"
          >
            <Edit className="w-3.5 h-3.5" />
            <span>تعديل البيانات</span>
          </Button>

          <Link href={`/cases?newClient=${client.id}`}>
            <Button size="sm" className="text-xs gap-1.5 bg-primary text-primary-foreground shadow-sm">
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة ملف قضية جديد</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Profile Header Card */}
      <Card className="shadow-sm border-border/80 overflow-hidden bg-card">
        <div className="h-3 bg-gradient-to-r from-amber-500 via-primary to-emerald-600" />
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${
                  client.type === 'company'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {client.type === 'company' ? (
                  <Building2 className="w-7 h-7" />
                ) : (
                  <User className="w-7 h-7" />
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl md:text-2xl font-bold text-foreground">
                    {client.name}
                  </h1>
                  <Badge
                    variant={client.type === 'company' ? 'secondary' : 'outline'}
                    className="text-xs"
                  >
                    {client.type === 'company' ? 'شركة / منشأة' : 'فرد طبيعي'}
                  </Badge>
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 text-xs">
                    نشط
                  </Badge>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pt-1">
                  <div className="font-mono">
                    <span className="font-semibold text-foreground">
                      {client.type === 'company' ? 'السجل التجاري: ' : 'الهوية الوطنية: '}
                    </span>
                    <span>{client.identityNumber || 'غير مسجل'}</span>
                  </div>

                  {client.contactPerson && (
                    <div>
                      <span className="font-semibold text-foreground">الممثل: </span>
                      <span>{client.contactPerson}</span>
                    </div>
                  )}

                  {client.address && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>{client.address}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Contact Actions */}
            <div className="flex items-center gap-2 self-stretch md:self-auto justify-end pt-2 md:pt-0 border-t md:border-t-0 border-border">
              {client.phone && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1.5 font-mono"
                    onClick={() => {
                      navigator.clipboard.writeText(client.phone);
                      toast({ title: 'تم النسخ', description: 'تم نسخ رقم الجوال إلى الحافظة' });
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span dir="ltr">{client.phone}</span>
                  </Button>

                  {waNumber && (
                    <a
                      href={`https://wa.me/${waNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 font-medium transition-colors"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>واتساب</span>
                    </a>
                  )}
                </>
              )}

              {client.email && (
                <a
                  href={`mailto:${client.email}`}
                  className="inline-flex items-center justify-center h-8 px-3 rounded-md border border-border bg-card hover:bg-accent text-xs gap-1.5 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>بريد</span>
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Financial Summary & Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-border/80 bg-card">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              القضايا المفتوحة
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold font-mono text-primary">
              {linkedCases.length}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">ملفات قضائية مسجلة</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              إجمالي الأتعاب التعاقدية
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold font-mono text-foreground">
              {financialSummary.totalFees.toLocaleString()} <span className="text-xs">ر.س</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">قيمة العقود الموقعة</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              المسدد فعلياً
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {financialSummary.paidFees.toLocaleString()} <span className="text-xs">ر.س</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Progress value={financialSummary.collectionRate} className="h-1.5 flex-1" />
              <span className="text-[10px] font-mono font-semibold text-muted-foreground">
                {financialSummary.collectionRate}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              المتبقي الواجب تحصيله
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div
              className={`text-2xl font-bold font-mono ${
                financialSummary.remainingFees > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600'
              }`}
            >
              {financialSummary.remainingFees.toLocaleString()} <span className="text-xs">ر.س</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {financialSummary.remainingFees > 0 ? 'دفعات مستحقة ومؤجلة' : 'تم سداد كامل الأتعاب'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Section: Cases, POAs, Notes */}
      <Tabs defaultValue="cases" className="space-y-4">
        <TabsList className="bg-muted/70 p-1">
          <TabsTrigger value="cases" className="gap-2 text-xs">
            <Briefcase className="w-3.5 h-3.5" />
            <span>ملفات القضايا ({linkedCases.length})</span>
          </TabsTrigger>
          <TabsTrigger value="poas" className="gap-2 text-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>الوكالات الشرعية ({linkedPoas.length})</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2 text-xs">
            <Scale className="w-3.5 h-3.5" />
            <span>الملاحظات والاتفاقيات</span>
          </TabsTrigger>
        </TabsList>

        {/* Linked Cases Tab */}
        <TabsContent value="cases" className="space-y-3">
          {linkedCases.length === 0 ? (
            <div className="py-12 text-center bg-card rounded-xl border border-dashed border-border p-6">
              <Briefcase className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-semibold text-foreground">لا توجد قضايا مسجلة لهذا العميل حتى الآن</p>
              <p className="text-xs text-muted-foreground mt-1">
                يمكنك إنشاء ملف قضية وربطه بالعميل مباشرة.
              </p>
              <Link href={`/cases?newClient=${client.id}`}>
                <Button size="sm" className="mt-3 gap-1.5 text-xs bg-primary text-primary-foreground">
                  <Plus className="w-3.5 h-3.5" />
                  <span>فتح ملف قضية للعميل</span>
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {linkedCases.map((c) => (
                <Card
                  key={c.id}
                  className="border-border/80 hover:border-primary/50 transition-all shadow-sm flex flex-col justify-between"
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                            {c.internalNumber}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            ناجز: {c.courtCaseNumber}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {c.stage}
                          </Badge>
                        </div>
                        <h4 className="font-bold text-sm text-foreground line-clamp-1">{c.title}</h4>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-4 pt-0 space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>الخصم / المدعى عليه:</span>
                      <span className="font-medium text-foreground">{c.opponentName}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span>المحكمة والدائرة:</span>
                      <span className="font-medium text-foreground truncate max-w-[200px]">
                        {c.court} {c.circuit ? `(${c.circuit})` : ''}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span>المحامي المسؤول:</span>
                      <span className="font-medium text-foreground">{c.assignedLawyer}</span>
                    </div>

                    {c.nextHearing && (
                      <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-between font-mono text-[11px]">
                        <span>الجلسة القادمة:</span>
                        <span className="font-bold">{c.nextHearing}</span>
                      </div>
                    )}
                  </CardContent>

                  <div className="p-3 bg-muted/20 border-t border-border flex items-center justify-between">
                    <span className="text-[11px] font-mono text-muted-foreground">
                      الأتعاب: {(c.totalFees || 0).toLocaleString()} ر.س
                    </span>
                    <Link href={`/cases/${c.id}`}>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-primary gap-1 px-2">
                        <span>فتح ملف القضية الموحد</span>
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* POAs Tab */}
        <TabsContent value="poas">
          {linkedPoas.length === 0 ? (
            <div className="py-12 text-center bg-card rounded-xl border border-dashed border-border p-6">
              <ShieldCheck className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-semibold text-foreground">لا توجد وكالات مسجلة للعميل</p>
              <p className="text-xs text-muted-foreground mt-1">
                يمكنك التحقق من الوكالات وإضافتها عبر قسم الوكالات.
              </p>
              <Link href="/poa">
                <Button size="sm" variant="outline" className="mt-3 gap-1.5 text-xs">
                  <span>الانتقال لإدارة الوكالات</span>
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {linkedPoas.map((poa, idx) => (
                <Card key={idx} className="border-border/80 p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-mono font-bold text-sm text-foreground">
                      وكالة رقم: {poa.poaNumber || poa.number}
                    </div>
                    <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">
                      سارية المفعول
                    </Badge>
                  </div>
                  <div className="text-muted-foreground">
                    <span>الموكل: </span>
                    <span className="font-medium text-foreground">{poa.clientName || client.name}</span>
                  </div>
                  <div className="text-muted-foreground">
                    <span>الوكيل المعتمد: </span>
                    <span className="font-medium text-foreground">{poa.agentName || 'محامي المكتب'}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Notes & Agreement Tab */}
        <TabsContent value="notes">
          <Card className="border-border/80 bg-card p-5 space-y-4 text-xs">
            <div>
              <h3 className="font-bold text-sm text-foreground mb-1">الملاحظات والشروط التعاقدية</h3>
              <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {client.notes || 'لا توجد ملاحظات أو اشتراطات خاصة مدونة لهذا الموكل.'}
              </p>
            </div>

            <div className="pt-3 border-t border-border grid grid-cols-2 gap-4 text-muted-foreground">
              <div>
                <span className="font-semibold text-foreground">تاريخ التسجيل بالمنظومة: </span>
                <span>{new Date(client.createdAt).toLocaleDateString('ar-SA')}</span>
              </div>
              {client.updatedAt && (
                <div>
                  <span className="font-semibold text-foreground">آخر تحديث: </span>
                  <span>{new Date(client.updatedAt).toLocaleDateString('ar-SA')}</span>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Client Modal */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[500px]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">تعديل بيانات الموكل</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">الاسم *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">رقم الجوال</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="text-xs font-mono text-left"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">الممثل النظامي</Label>
                <Input
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">البريد الإلكتروني</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="text-xs font-mono text-left"
                  dir="ltr"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">العنوان والمدينة</Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">الملاحظات</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-xs min-h-[70px]"
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
                {updateMutation.isPending ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
