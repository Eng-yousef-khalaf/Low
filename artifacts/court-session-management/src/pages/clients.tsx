import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Users,
  Building2,
  User,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Coins,
  ChevronLeft,
  ExternalLink,
  MessageCircle,
  FileText,
  AlertCircle,
  CheckCircle2,
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

export interface ClientItem {
  id: string;
  name: string;
  type: 'individual' | 'company';
  identityNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  contactPerson?: string;
  notes?: string;
  status: 'active' | 'archived';
  createdAt: string;
  linkedCasesCount?: number;
  totalFees?: number;
  paidFees?: number;
  remainingFees?: number;
  linkedPoas?: any[];
}

export default function ClientsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'individual' | 'company'>('all');
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'individual' | 'company'>('company');
  const [identityNumber, setIdentityNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [notes, setNotes] = useState('');

  // Fetch clients
  const { data: clients = [], isLoading, isError } = useQuery<ClientItem[]>({
    queryKey: ['/api/clients'],
    queryFn: async () => {
      const res = await fetch('/api/clients');
      if (!res.ok) throw new Error('فشل تحميل قائمة العملاء');
      return res.json();
    },
  });

  // Create client mutation
  const createMutation = useMutation({
    mutationFn: async (newClient: Partial<ClientItem>) => {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClient),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل إضافة العميل');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      toast({
        title: 'تمت العملية بنجاح',
        description: 'تم تسجيل العميل بنجاح وربطه بالمنظومة القانونية.',
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
    setName('');
    setType('company');
    setIdentityNumber('');
    setPhone('');
    setEmail('');
    setAddress('');
    setContactPerson('');
    setNotes('');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({
        title: 'تنبيه',
        description: 'يرجى إدخال اسم العميل أو الشركة.',
        variant: 'destructive',
      });
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      type,
      identityNumber: identityNumber.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      contactPerson: contactPerson.trim() || undefined,
      notes: notes.trim() || undefined,
      status: 'active',
    });
  };

  // Filter clients
  const filteredClients = clients.filter((c) => {
    const matchesType = typeFilter === 'all' || c.type === typeFilter;
    const matchesSearch =
      searchTerm.trim() === '' ||
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.identityNumber && c.identityNumber.includes(searchTerm)) ||
      (c.phone && c.phone.includes(searchTerm)) ||
      (c.contactPerson && c.contactPerson.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesType && matchesSearch;
  });

  // Summary statistics
  const totalClients = clients.length;
  const companyCount = clients.filter((c) => c.type === 'company').length;
  const individualCount = clients.filter((c) => c.type === 'individual').length;
  const totalDues = clients.reduce((acc, c) => acc + (c.remainingFees || 0), 0);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto" dir="rtl">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
                إدارة الموكلين والعملاء
              </h1>
              <p className="text-xs md:text-sm text-muted-foreground">
                ملفات مركزية شاملة للموكلين ترتبط تلقائياً بالقضايا، الجلسات، والوكالات الشرعية.
              </p>
            </div>
          </div>
        </div>

        {/* Add Client Dialog */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
              data-testid="button-add-client-trigger"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة عميل جديد</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[550px]" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <span>تسجيل موكل / عميل جديد</span>
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleCreate} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="client-type" className="text-xs font-semibold">
                    نوع الموكل *
                  </Label>
                  <Select value={type} onValueChange={(val: any) => setType(val)}>
                    <SelectTrigger id="client-type" className="text-xs">
                      <SelectValue placeholder="اختر النوع" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="company">شركة أو مؤسسة</SelectItem>
                      <SelectItem value="individual">فرد (شخص طبيعي)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="identity-number" className="text-xs font-semibold">
                    {type === 'company' ? 'رقم السجل التجاري' : 'رقم الهوية الوطنية / الإقامة'}
                  </Label>
                  <Input
                    id="identity-number"
                    placeholder={type === 'company' ? 'مثال: 1010892341' : 'مثال: 1098765432'}
                    value={identityNumber}
                    onChange={(e) => setIdentityNumber(e.target.value)}
                    className="text-xs font-mono text-left"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="client-name" className="text-xs font-semibold">
                  {type === 'company' ? 'اسم المنشأة أو الشركة *' : 'اسم الموكل رباعي *'}
                </Label>
                <Input
                  id="client-name"
                  placeholder={type === 'company' ? 'مثال: شركة الرواد للمقاولات المحدودة' : 'مثال: محمد بن سعد القحطاني'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="contact-person" className="text-xs font-semibold">
                    {type === 'company' ? 'الممثل النظامي / جهة الاتصال' : 'صفة التمثيل'}
                  </Label>
                  <Input
                    id="contact-person"
                    placeholder={type === 'company' ? 'مثال: أ. فهد التميمي (المدير العام)' : 'أصيل أو وكيل'}
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="client-phone" className="text-xs font-semibold">
                    رقم الجوال *
                  </Label>
                  <Input
                    id="client-phone"
                    placeholder="مثال: 0501234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="text-xs font-mono text-left"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="client-email" className="text-xs font-semibold">
                    البريد الإلكتروني
                  </Label>
                  <Input
                    id="client-email"
                    type="email"
                    placeholder="legal@company.sa"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="text-xs font-mono text-left"
                    dir="ltr"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="client-address" className="text-xs font-semibold">
                    المدينة والعنوان
                  </Label>
                  <Input
                    id="client-address"
                    placeholder="الرياض - حي العليا"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="client-notes" className="text-xs font-semibold">
                  ملاحظات تعاقدية أو شروط خاصة
                </Label>
                <Textarea
                  id="client-notes"
                  placeholder="طبيعة التعامل، تفاصيل الاتفاق، آلية التواصل المفضلة..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-xs min-h-[60px]"
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
                  className="text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {createMutation.isPending ? 'جاري الحفظ...' : 'حفظ بيانات العميل'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card className="shadow-sm border-border/80 bg-card hover:border-primary/40 transition-colors">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span>إجمالي العملاء</span>
              <Users className="w-4 h-4 text-primary" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold font-mono text-foreground">{totalClients}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">موكل مسجل بالمنظومة</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/80 bg-card hover:border-primary/40 transition-colors">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span>شركات ومؤسسات</span>
              <Building2 className="w-4 h-4 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              {companyCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">عقود تجارية واعتبارية</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/80 bg-card hover:border-primary/40 transition-colors">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span>أفراد ومواطنين</span>
              <User className="w-4 h-4 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {individualCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">أشخاص طبيعيين</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/80 bg-card hover:border-primary/40 transition-colors">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span>متبقي الأتعاب المستحقة</span>
              <Coins className="w-4 h-4 text-red-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">
              {totalDues.toLocaleString()} <span className="text-xs font-normal">ر.س</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">مطالبات قيد السداد</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />
          <Input
            placeholder="بحث بالاسم، رقم السجل، الهوية، أو الجوال..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-9 text-xs"
            data-testid="input-search-clients"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <Button
            size="sm"
            variant={typeFilter === 'all' ? 'default' : 'outline'}
            onClick={() => setTypeFilter('all')}
            className="text-xs h-8 px-3 rounded-lg"
          >
            الكل ({clients.length})
          </Button>
          <Button
            size="sm"
            variant={typeFilter === 'company' ? 'default' : 'outline'}
            onClick={() => setTypeFilter('company')}
            className="text-xs h-8 px-3 rounded-lg flex items-center gap-1.5"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>شركات ({companyCount})</span>
          </Button>
          <Button
            size="sm"
            variant={typeFilter === 'individual' ? 'default' : 'outline'}
            onClick={() => setTypeFilter('individual')}
            className="text-xs h-8 px-3 rounded-lg flex items-center gap-1.5"
          >
            <User className="w-3.5 h-3.5" />
            <span>أفراد ({individualCount})</span>
          </Button>
        </div>
      </div>

      {/* Clients Cards Grid */}
      {isLoading ? (
        <div className="py-16 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">جاري تحميل سجلات العملاء...</p>
        </div>
      ) : isError ? (
        <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p className="font-semibold text-sm">حدث خطأ أثناء تحميل سجلات العملاء</p>
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="py-16 text-center bg-card rounded-2xl border border-dashed border-border p-8">
          <Users className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-foreground">لا يوجد عملاء مطابقين للبحث</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            قم بإضافة عميل جديد لربطه بالقضايا والجلسات المباشرة.
          </p>
          <Button
            size="sm"
            onClick={() => setIsAddOpen(true)}
            className="mt-4 gap-1.5 text-xs bg-primary text-primary-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة أول عميل</span>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClients.map((client) => {
            const hasPhone = !!client.phone;
            const waNumber = client.phone ? client.phone.replace(/[^0-9]/g, '') : '';

            return (
              <Card
                key={client.id}
                className="overflow-hidden border-border/80 hover:border-primary/40 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Card Top Banner */}
                  <div className="p-4 pb-3 border-b border-border/50 bg-muted/20 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          client.type === 'company'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {client.type === 'company' ? (
                          <Building2 className="w-4 h-4" />
                        ) : (
                          <User className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/clients/${client.id}`}>
                          <h3 className="font-bold text-sm text-foreground hover:text-primary transition-colors cursor-pointer truncate">
                            {client.name}
                          </h3>
                        </Link>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">
                          {client.type === 'company' ? 'س.ت: ' : 'هوية: '}
                          {client.identityNumber || 'غير مسجل'}
                        </p>
                      </div>
                    </div>

                    <Badge
                      variant={client.type === 'company' ? 'secondary' : 'outline'}
                      className="text-[10px] shrink-0"
                    >
                      {client.type === 'company' ? 'شركة' : 'فرد'}
                    </Badge>
                  </div>

                  {/* Card Content Details */}
                  <div className="p-4 space-y-2.5 text-xs">
                    {client.contactPerson && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="font-medium text-foreground">الممثل:</span>
                        <span className="truncate">{client.contactPerson}</span>
                      </div>
                    )}

                    {client.phone && (
                      <div className="flex items-center justify-between text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-primary" />
                          <span className="font-mono" dir="ltr">
                            {client.phone}
                          </span>
                        </div>
                        {waNumber && (
                          <a
                            href={`https://wa.me/${waNumber}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                            title="مراسلة عبر واتساب"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    )}

                    {client.address && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{client.address}</span>
                      </div>
                    )}

                    {/* Quick Stats Badges inside card */}
                    <div className="pt-2 border-t border-border/50 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-muted/40 p-2 rounded-lg flex items-center justify-between">
                        <span className="text-muted-foreground">القضايا:</span>
                        <span className="font-bold font-mono text-foreground flex items-center gap-1">
                          <Briefcase className="w-3 h-3 text-primary" />
                          {client.linkedCasesCount || 0}
                        </span>
                      </div>

                      <div className="bg-muted/40 p-2 rounded-lg flex items-center justify-between">
                        <span className="text-muted-foreground">المتبقي:</span>
                        <span
                          className={`font-bold font-mono ${
                            (client.remainingFees || 0) > 0 ? 'text-red-500' : 'text-emerald-500'
                          }`}
                        >
                          {(client.remainingFees || 0).toLocaleString()} ر.س
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Footer Action */}
                <div className="p-3 bg-muted/10 border-t border-border/50 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    مسجل منذ: {new Date(client.createdAt).toLocaleDateString('ar-SA')}
                  </span>
                  <Link href={`/clients/${client.id}`}>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-primary gap-1 px-2">
                      <span>الملف الكامل</span>
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
