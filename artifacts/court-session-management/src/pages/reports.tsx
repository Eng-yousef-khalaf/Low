import { useState } from 'react';
import { Link } from 'wouter';
import { useListSessions } from '@workspace/api-client-react';
import { FileText, ChevronLeft, CheckCircle2, Clock, Scale, User, ArrowUpDown, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { sortSessions, type SortOption } from '@/lib/session-sort';
import { getArabicDayName } from '@/lib/hijri';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function deriveEffectiveStatus(storedStatus: string, hearingAt: string | null | undefined) {
  if (storedStatus === 'Cancelled' || storedStatus === 'Finished') return storedStatus;
  if (!hearingAt) return storedStatus;
  const hearing = new Date(hearingAt);
  const now = new Date();
  if (hearing.getTime() < now.getTime()) return 'Finished';
  const sameDay =
    hearing.getUTCFullYear() === now.getUTCFullYear() &&
    hearing.getUTCMonth() === now.getUTCMonth() &&
    hearing.getUTCDate() === now.getUTCDate();
  return sameDay ? 'Today' : 'Upcoming';
}

export default function ReportsPage() {
  const [sortBy, setSortBy] = useState<SortOption>('nearest');
  const { data: sessions, isLoading, error, refetch } = useListSessions();

  const sortedSessions = Array.isArray(sessions) ? sortSessions(sessions, sortBy) : [];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="fade-in-up flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-6 rounded-full bg-primary" />
            <h1 className="text-2xl font-bold tracking-tight">تقارير الجلسات</h1>
          </div>
          <p className="text-muted-foreground text-sm mr-3">
            إدارة وعرض تقارير الجلسات مرتبة حسب التوقيت الأقرب
          </p>
        </div>

        {/* Sort Select */}
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="h-9 text-xs gap-1.5 bg-card border-border min-w-[170px]" data-testid="select-sort-reports">
              <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="الترتيب" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="nearest">الأقرب زمناً (تلقائي)</SelectItem>
              <SelectItem value="furthest">الأبعد زمناً</SelectItem>
              <SelectItem value="newest">أحدث مضافاً</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content Rendering: Loading -> Error -> List -> Empty */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start gap-4">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="fade-in-up rounded-2xl border border-destructive/30 bg-destructive/8 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-destructive/15 text-destructive flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-destructive">فشل تحميل قائمة تقارير الجلسات</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
              تعذر الاتصال بـ Google Sheets لجلب بيانات الجلسات. يرجى التحقق من اتصال الشبكة وصلاحيات ملف الاعتماد ثم إعادة المحاولة.
            </p>
          </div>
          <Button
            onClick={() => refetch()}
            variant="outline"
            className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            إعادة محاولة التحميل
          </Button>
        </div>
      ) : sortedSessions.length > 0 ? (
        <div className="space-y-3 fade-in-up fade-in-up-delay-2">
          {sortedSessions.map((session, i) => {
            const effectiveStatus = deriveEffectiveStatus(session.status, session.hearingAt);
            const isFinished = effectiveStatus === 'Finished';

            return (
              <Link key={session.id} href={`/reports/${session.id}`}>
                <div
                  className="group rounded-xl border border-border bg-card p-5 cursor-pointer transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5"
                  style={{ animationDelay: `${i * 0.04}s` }}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors ${isFinished ? 'bg-emerald-500/10 group-hover:bg-emerald-500/20' : 'bg-primary/10 group-hover:bg-primary/20'}`}>
                      <FileText className={`w-5 h-5 ${isFinished ? 'text-emerald-500' : 'text-primary'}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-base font-mono">
                            {session.caseNumber || '—'}
                          </h3>
                          {/* Report status badge */}
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                            isFinished
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              : 'bg-muted text-muted-foreground border-border'
                          }`}>
                            {isFinished ? (
                              <><CheckCircle2 className="w-3 h-3" /> جاهزة للتقرير</>
                            ) : (
                              <><Clock className="w-3 h-3" /> لم تُعقد بعد</>
                            )}
                          </span>
                        </div>
                        <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                        {session.plaintiff && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <User className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{session.plaintiff}</span>
                            {session.defendant && <span className="text-muted-foreground/50">←</span>}
                            {session.defendant && <span className="truncate">{session.defendant}</span>}
                          </div>
                        )}
                        {session.court && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Scale className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{session.court}</span>
                          </div>
                        )}
                        {(session.sessionDateHijri || session.hearingAt) && (
                          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                            📅 {getArabicDayName(session) && <span className="font-medium text-foreground">{getArabicDayName(session)} ·</span>}
                            {session.sessionDateHijri && <span className="font-mono">{session.sessionDateHijri}</span>}
                            {session.sessionTime && <span className="font-mono text-muted-foreground/70">· {session.sessionTime}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="fade-in-up fade-in-up-delay-2 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
            <FileText className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">لا توجد جلسات</h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            أضف جلسات أولاً من قسم "تحليل رسالة" ثم ادخل التقارير هنا.
          </p>
        </div>
      )}
    </div>
  );
}
