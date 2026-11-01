import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from 'wouter';
import {
  Briefcase,
  Plus,
  Search,
  Scale,
  Calendar,
  AlertTriangle,
  User,
  Users,
  Building2,
  ChevronLeft,
  Filter,
  CheckCircle2,
  Clock,
  ArrowUpDown,
  Coins,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

export type CaseStage = 'ابتدائية' | 'استئناف' | 'تنفيذ' | 'عليا' | 'صلح وتسوية';
export type CaseStatus = 'active' | 'closed' | 'appealed' | 'suspended';

export interface CaseItem {
  id: string;
  internalNumber: string;
  courtCaseNumber: string;
  title: string;
  clientId: string;
  clientName: string;
  opponentName: string;
  court: string;
  circuit?: string;
  assignedLawyer: string;
  stage: CaseStage;
  status: CaseStatus;
  filingDateHijri?: string;
  nextHearing?: string;
  lastAction?: string;
  requiredAction?: string;
  missingDocuments?: string[];
  totalFees?: number;
  paidFees?: number;
  notes?: string;
  createdAt: string;
}

export default function CasesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchParams = new URLSearchParams(useSearch());
  const initialClientId = searchParams.get('newClient') || '';

  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form states
  const [internalNumber, setInternalNumber] = useState(`CAS-2026-${Math.floor(100 + Math.random() * 900)}`);
  const [courtCaseNumber, setCourtCaseNumber] = useState('');
  const [title, setTitle] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(initialClientId);
  const [opponentName, setOpponentName] = useState('');
  const [court, setCourt] = useState('المحكمة العامة بالرياض');
  const [circuit, setCircuit] = useState('');
  const [assignedLawyer, setAssignedLawyer] = useState('المحامي الافتراضي');
  const [stage, setStage] = useState<CaseStage>('ابتدائية');
  const [status, setStatus] = useState<CaseStatus>('active');
  const [filingDateHijri, setFilingDateHijri] = useState('');
  const [totalFees, setTotalFees] = useState('');
  const [paidFees, setPaidFees] = useState('');
  const [missingDocsText, setMissingDocsText] = useState('');
  const [notes, setNotes] = useState('');

  // Fetch clients for dropdown
  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ['/api/clients'],
    queryFn: async () => {
      const res = await fetch('/api/clients');
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch team for lawyer selection
  const { data: team = [] } = useQuery<any[]>({
    queryKey: ['/api/team'],
    queryFn: async () => {
      const res = await fetch('/api/team');
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Open modal if newClient query param is present
  useEffect(() => {
    if (initialClientId) {
      setSelectedClientId(initialClientId);
      setIsAddOpen(true);
    }
  }, [initialClientId]);

  // Fetch cases
  const { data: cases = [], isLoading, isError } = useQuery<CaseItem[]>({
    queryKey: ['/api/cases'],
    queryFn: async () => {
      const res = await fetch('/api/cases');
      if (!res.ok) throw new Error('فشل جلب قائمة القضايا');
      return res.json();
    },
  });

  // Create case mutation
  const createMutation = useMutation({
    mutationFn: async (newCase: any) => {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCase),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل فتح ملف القضية');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cases'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      toast({
        title: 'تم إنشاء ملف القضية',
        description: 'تم فتح الملف وتوحيد كافة بيانات الجلسات والمهام والأحكام بنجاح.',
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

  const resetForm = () => {
    setInternalNumber(`CAS-2026-${Math.floor(100 + Math.random() * 900)}`);
    setCourtCaseNumber('');
    setTitle('');
    setSelectedClientId('');
    setOpponentName('');
    setCourt('المحكمة العامة بالرياض');
    setCircuit('');
    setAssignedLawyer('المحامي الافتراضي');
    setStage('ابتدائية');
    setStatus('active');
    setFilingDateHijri('');
    setTotalFees('');
    setPaidFees('');
    setMissingDocsText('');
    setNotes('');
  };

  const handleCreateCase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!courtCaseNumber.trim() || !title.trim() || !selectedClientId) {
      toast({
        title: 'حقول مطلوبة',
        description: 'يرجى ملء رقم القضية بناجز، عنوان الدعوى، واختيار الموكل.',
        variant: 'destructive',
      });
      return;
    }

    const selectedClient = clients.find((c) => c.id === selectedClientId);

    const missingDocs = missingDocsText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    createMutation.mutate({
      internalNumber: internalNumber.trim(),
      courtCaseNumber: courtCaseNumber.trim(),
      title: title.trim(),
      clientId: selectedClientId,
      clientName: selectedClient?.name || 'موكل عام',
      opponentName: opponentName.trim() || 'المدعى عليه',
      court: court.trim(),
      circuit: circuit.trim() || undefined,
      assignedLawyer: assignedLawyer.trim(),
      stage,
      status,
      filingDateHijri: filingDateHijri.trim() || undefined,
      totalFees: totalFees ? parseFloat(totalFees) : 0,
      paidFees: paidFees ? parseFloat(paidFees) : 0,
      missingDocuments: missingDocs,
      notes: notes.trim() || undefined,
    });
  };

  // Filter cases
  const filteredCases = cases.filter((c) => {
    const matchesStage = stageFilter === 'all' || c.stage === stageFilter;
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      searchTerm.trim() === '' ||
      c.internalNumber.toLowerCase().includes(q) ||
      c.courtCaseNumber.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.clientName.toLowerCase().includes(q) ||
      c.opponentName.toLowerCase().includes(q) ||
      c.court.toLowerCase().includes(q);

    return matchesStage && matchesStatus && matchesSearch;
  });

  // Stats
  const totalCount = cases.length;
  const primaryCount = cases.filter((c) => c.stage === 'ابتدائية').length;
  const appealCount = cases.filter((c) => c.stage === 'استئناف').length;
  const execCount = cases.filter((c) => c.stage === 'تنفيذ').length;
  const urgentCount = cases.filter((c) => (c.missingDocuments?.length || 0) > 0 || c.requiredAction).length;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            <Briefcase className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
              ملفات القضايا الموحدة
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              ملف شامل يجمع العميل، الأطراف، الجلسات، المهام، الأحكام، ونواقص المستندات في مكان واحد.
            </p>
          </div>
        </div>

        {/* Add Case Dialog */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
              data-testid="button-add-case-trigger"
            >
              <Plus className="w-4 h-4" />
              <span>فتح ملف قضية جديد</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-primary" />
                <span>فتح ملف قضية قضائي موحد</span>
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleCreateCase} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">رقم الملف الداخلي بالمكتب *</Label>
                  <Input
                    value={internalNumber}
                    onChange={(e) => setInternalNumber(e.target.value)}
                    placeholder="مثال: CAS-2026-001"
                    className="text-xs font-mono text-left"
                    dir="ltr"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">رقم القضية في ناجز / المحكمة *</Label>
                  <Input
                    value={courtCaseNumber}
                    onChange={(e) => setCourtCaseNumber(e.target.value)}
                    placeholder="مثال: 441098234"
                    className="text-xs font-mono text-left"
                    dir="ltr"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">موضوع الدعوى / عنوان القضية *</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثال: دعوى مطالبة مالية بمستحقات عقد مقاولات وتوريد"
                  className="text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">الموكل (العميل) *</Label>
                  <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="اختر الموكل من السجل" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.type === 'company' ? 'شركة' : 'فرد'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">الخصم / المدعى عليه *</Label>
                  <Input
                    value={opponentName}
                    onChange={(e) => setOpponentName(e.target.value)}
                    placeholder="اسم الخصم أو الشركة المدعى عليها"
                    className="text-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">المحكمة *</Label>
                  <Input
                    value={court}
                    onChange={(e) => setCourt(e.target.value)}
                    placeholder="مثال: المحكمة التجارية بالرياض"
                    className="text-xs"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">الدائرة القضائية</Label>
                  <Input
                    value={circuit}
                    onChange={(e) => setCircuit(e.target.value)}
                    placeholder="مثال: الدائرة الثالثة"
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">المرحلة الحالية</Label>
                  <Select value={stage} onValueChange={(val: any) => setStage(val)}>
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="المرحلة" />
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

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">حالة الملف</Label>
                  <Select value={status} onValueChange={(val: any) => setStatus(val)}>
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="الحالة" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="active">جارية (نشطة)</SelectItem>
                      <SelectItem value="appealed">مستأنفة</SelectItem>
                      <SelectItem value="closed">منتهية ومحكومة</SelectItem>
                      <SelectItem value="suspended">موقوفة مؤقتاً</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">المحامي المسؤول</Label>
                  <Input
                    value={assignedLawyer}
                    onChange={(e) => setAssignedLawyer(e.target.value)}
                    placeholder="اسم المحامي"
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">إجمالي الأتعاب التعاقدية (ر.س)</Label>
                  <Input
                    type="number"
                    value={totalFees}
                    onChange={(e) => setTotalFees(e.target.value)}
                    placeholder="مثال: 50000"
                    className="text-xs font-mono text-left"
                    dir="ltr"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">المدفوع منها حتى الآن (ر.س)</Label>
                  <Input
                    type="number"
                    value={paidFees}
                    onChange={(e) => setPaidFees(e.target.value)}
                    placeholder="مثال: 25000"
                    className="text-xs font-mono text-left"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>نواقص المستندات المطلوبة (مستند في كل سطر)</span>
                </Label>
                <Textarea
                  value={missingDocsText}
                  onChange={(e) => setMissingDocsText(e.target.value)}
                  placeholder="مثال:&#10;محضر تسليم الموقع الأصلي&#10;صورة الفواتير المعتمدة&#10;وكالة الشريك الثاني"
                  className="text-xs min-h-[60px]"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">ملاحظات وتقدير الموقف القانوني</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملخص الثغرات ودفوع الخصم ونقاط القوة..."
                  className="text-xs min-h-[50px]"
                />
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
                  {createMutation.isPending ? 'جاري الفتح...' : 'إنشاء وحفظ ملف القضية'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-border/80 bg-card">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center justify-between">
              <span>إجمالي القضايا</span>
              <Briefcase className="w-4 h-4 text-primary" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold font-mono text-foreground">{totalCount}</div>
            <p className="text-[10px] text-muted-foreground">ملف بالمنظومة</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center justify-between">
              <span>مرحلة ابتدائية</span>
              <Scale className="w-4 h-4 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">
              {primaryCount}
            </div>
            <p className="text-[10px] text-muted-foreground">مرافعة ودفاع</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center justify-between">
              <span>مرحلة استئناف</span>
              <ArrowUpDown className="w-4 h-4 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              {appealCount}
            </div>
            <p className="text-[10px] text-muted-foreground">لوائح اعتراضية</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center justify-between">
              <span>مرحلة التنفيذ</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {execCount}
            </div>
            <p className="text-[10px] text-muted-foreground">محاكم التنفيذ</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs text-muted-foreground flex items-center justify-between">
              <span>إجراءات أو نواقص</span>
              <AlertTriangle className="w-4 h-4 text-red-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">
              {urgentCount}
            </div>
            <p className="text-[10px] text-muted-foreground">تتطلب تدخلاً عاجلاً</p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />
          <Input
            placeholder="بحث برقم الملف، ناجز، الموكل، الخصم، أو المحكمة..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-9 text-xs"
            data-testid="input-search-cases"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <Button
            size="sm"
            variant={stageFilter === 'all' ? 'default' : 'outline'}
            onClick={() => setStageFilter('all')}
            className="text-xs h-8 px-2.5 rounded-lg"
          >
            جميع المراحل
          </Button>
          <Button
            size="sm"
            variant={stageFilter === 'ابتدائية' ? 'default' : 'outline'}
            onClick={() => setStageFilter('ابتدائية')}
            className="text-xs h-8 px-2.5 rounded-lg"
          >
            ابتدائية ({primaryCount})
          </Button>
          <Button
            size="sm"
            variant={stageFilter === 'استئناف' ? 'default' : 'outline'}
            onClick={() => setStageFilter('استئناف')}
            className="text-xs h-8 px-2.5 rounded-lg"
          >
            استئناف ({appealCount})
          </Button>
          <Button
            size="sm"
            variant={stageFilter === 'تنفيذ' ? 'default' : 'outline'}
            onClick={() => setStageFilter('تنفيذ')}
            className="text-xs h-8 px-2.5 rounded-lg"
          >
            تنفيذ ({execCount})
          </Button>
        </div>
      </div>

      {/* Cases List */}
      {isLoading ? (
        <div className="py-16 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">جاري تحميل سجلات القضايا...</p>
        </div>
      ) : isError ? (
        <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p className="font-semibold text-sm">حدث خطأ أثناء تحميل سجلات القضايا</p>
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="py-16 text-center bg-card rounded-2xl border border-dashed border-border p-8">
          <Briefcase className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-foreground">لا توجد قضايا مطابقة للبحث</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            قم بفتح ملف قضية جديد لتوحيد الجلسات والأحكام والمهام.
          </p>
          <Button
            size="sm"
            onClick={() => setIsAddOpen(true)}
            className="mt-4 gap-1.5 text-xs bg-primary text-primary-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>فتح أول ملف قضية</span>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCases.map((caseItem) => {
            const hasMissing = (caseItem.missingDocuments?.length || 0) > 0;

            return (
              <Card
                key={caseItem.id}
                className="overflow-hidden border-border/80 hover:border-primary/50 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top Bar with internal ID & Stage Badge */}
                  <div className="p-3.5 pb-2.5 bg-muted/20 border-b border-border/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-primary px-2 py-0.5 rounded bg-primary/10">
                        {caseItem.internalNumber}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        ناجز: {caseItem.courtCaseNumber}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {caseItem.stage}
                      </Badge>
                      <Badge
                        variant={caseItem.status === 'active' ? 'secondary' : 'outline'}
                        className={`text-[10px] ${
                          caseItem.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : ''
                        }`}
                      >
                        {caseItem.status === 'active'
                          ? 'نشطة'
                          : caseItem.status === 'appealed'
                          ? 'مستأنفة'
                          : 'محكومة'}
                      </Badge>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 space-y-3">
                    <Link href={`/cases/${caseItem.id}`}>
                      <h3 className="font-bold text-sm text-foreground hover:text-primary transition-colors cursor-pointer line-clamp-2">
                        {caseItem.title}
                      </h3>
                    </Link>

                    <div className="space-y-1.5 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-foreground font-medium">
                          <User className="w-3.5 h-3.5 text-primary" />
                          <span>الموكل:</span>
                        </span>
                        <Link href={`/clients/${caseItem.clientId}`}>
                          <span className="text-primary hover:underline cursor-pointer truncate max-w-[160px]">
                            {caseItem.clientName}
                          </span>
                        </Link>
                      </div>

                      <div className="flex items-center justify-between">
                        <span>الخصم:</span>
                        <span className="font-medium text-foreground truncate max-w-[160px]">
                          {caseItem.opponentName}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span>المحكمة:</span>
                        <span className="truncate max-w-[180px]">{caseItem.court}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span>المحامي المسؤول:</span>
                        <span className="font-medium text-foreground">{caseItem.assignedLawyer}</span>
                      </div>
                    </div>

                    {/* Missing Documents Alert Banner */}
                    {hasMissing && (
                      <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>نواقص مستندات:</span>
                        </span>
                        <span className="font-bold font-mono">
                          {caseItem.missingDocuments?.length} مستندات
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Link */}
                <div className="p-3 bg-muted/15 border-t border-border flex items-center justify-between">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    الأتعاب: {(caseItem.totalFees || 0).toLocaleString()} ر.س
                  </span>
                  <Link href={`/cases/${caseItem.id}`}>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-primary gap-1 px-2">
                      <span>الملف الموحد</span>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
