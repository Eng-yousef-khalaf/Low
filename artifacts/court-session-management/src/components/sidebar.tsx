import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Moon,
  Sun,
  LogOut,
  Settings,
  Scale,
  FileText,
  ShieldCheck,
  Gavel,
  CheckSquare,
  Users,
  Sparkles,
  Shield,
  AlertTriangle,
  Briefcase,
  UserCheck,
} from 'lucide-react';
import { useTheme } from './theme-provider';
import { useLogout, useGetCurrentUser } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { GlobalSearch } from './global-search';
import { purgeSensitiveLocalStorageOnLogout } from '@/lib/user-storage';

const baseNavigation = [
  { name: 'لوحة التحكم', path: '/', icon: LayoutDashboard },
  { name: 'تحليل رسالة', path: '/chat', icon: MessageSquare },
  { name: 'العملاء والموكلين', path: '/clients', icon: Users },
  { name: 'ملفات القضايا', path: '/cases', icon: Briefcase },
  { name: 'جميع الجلسات', path: '/sessions', icon: Calendar },
  { name: 'تقارير الجلسات', path: '/reports', icon: FileText },
  { name: 'الوكالات', path: '/poa', icon: ShieldCheck },
  { name: 'الأحكام', path: '/judgments', icon: Gavel },
  { name: 'المهام', path: '/tasks', icon: CheckSquare },
  { name: 'فريق العمل والصلاحيات', path: '/team', icon: UserCheck },
];

const adminNavigation = [
  { name: 'بوابة المشرف العام', path: '/admin', icon: Shield },
  { name: 'إعدادات النظام', path: '/settings', icon: Settings },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const logoutMutation = useLogout();
  const { data: currentUser } = useGetCurrentUser();
  const user = currentUser as any;

  const handleLogout = () => {
    onNavigate?.();
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        purgeSensitiveLocalStorageOnLogout();
        queryClient.clear();
        window.location.href = '/login';
      },
      onError: () => {
        purgeSensitiveLocalStorageOnLogout();
        queryClient.clear();
        toast({
          title: 'خطأ',
          description: 'فشل تسجيل الخروج من الخادم، تم مسح الجلسة المحلية.',
          variant: 'destructive',
        });
        window.location.href = '/login';
      },
    });
  };

  const renderConnectionBadge = () => {
    const linkStatus = user?.googleLinkStatus as
      | 'connected'
      | 'local_isolated'
      | 'unlinked'
      | 'incomplete'
      | undefined;

    if (linkStatus === 'connected') {
      return (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          <span>مزامنة Google Sheets (متصلة)</span>
        </>
      );
    }

    if (linkStatus === 'incomplete' || linkStatus === 'unlinked') {
      return (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />
          <span className="text-amber-300">ربط جدول المكتب غير مكتمل</span>
        </>
      );
    }

    return (
      <>
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
        <span>تخزين المكتب المعزول (نشط)</span>
      </>
    );
  };

  return (
    <div
      className="flex flex-col h-full sidebar-gradient"
      style={{
        background:
          theme === 'dark'
            ? 'linear-gradient(160deg, #051F17 0%, #093A2A 55%, #03120E 100%)'
            : 'linear-gradient(160deg, #093A2A 0%, #0D4E3A 55%, #06261C 100%)',
        borderInlineStart:
          theme === 'dark'
            ? '1px solid rgba(255,255,255,0.06)'
            : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Logo/Brand */}
      <div
        className="p-4 space-y-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: '#B88A3B',
              boxShadow: '0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.3)',
            }}
          >
            <Scale className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs font-bold text-white leading-tight truncate">
              إدارة جلسات المحكمة
            </h1>
            <p className="text-[10px] mt-0.5 truncate" style={{ color: '#B88A3B' }}>
              {user?.displayName || user?.username || 'بوابة المكتب القانوني'}
            </p>
          </div>
        </div>

        {/* Global Search Button */}
        <GlobalSearch />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto" aria-label="القائمة الرئيسية">
        <p
          className="text-[10px] font-semibold uppercase tracking-widest px-3 py-2"
          style={{ color: 'rgba(255,255,255,0.4)' }}
        >
          القائمة الرئيسية
        </p>

        {(user?.role === 'admin' ? [...baseNavigation, ...adminNavigation] : baseNavigation).map(
          (item) => {
            const isActive = location === item.path;
            const Icon = item.icon;

            return (
              <Link
                key={item.path}
                href={item.path}
                onClick={() => onNavigate?.()}
                data-testid={`nav-${item.path === '/' ? 'dashboard' : item.path.slice(1)}`}
              >
                <div
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer"
                  style={
                    isActive
                      ? {
                          background: '#B88A3B',
                          color: '#ffffff',
                          boxShadow:
                            'inset 0 1px 0 rgba(255,255,255,0.3), 0 2px 8px rgba(0,0,0,0.25)',
                        }
                      : {
                          color: 'rgba(255,255,255,0.75)',
                        }
                  }
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLDivElement).style.background =
                        'rgba(255,255,255,0.1)';
                      (e.currentTarget as HTMLDivElement).style.color = '#ffffff';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLDivElement).style.background = '';
                      (e.currentTarget as HTMLDivElement).style.color = 'rgba(255,255,255,0.75)';
                    }
                  }}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{item.name}</span>
                  {isActive && (
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: '#ffffff' }}
                    />
                  )}
                </div>
              </Link>
            );
          },
        )}
      </nav>

      {/* Subscription & Storage Connection Info */}
      {user && (
        <div
          className="mx-3 mb-2 p-2.5 rounded-xl border space-y-1.5 text-xs"
          style={{
            background: 'rgba(255,255,255,0.04)',
            borderColor:
              user.isExpired || user.isSuspended
                ? 'rgba(239,68,68,0.4)'
                : 'rgba(255,255,255,0.1)',
          }}
        >
          {user.isExpired || user.isSuspended ? (
            <div className="space-y-1 text-red-300">
              <div className="flex items-center gap-1.5 font-bold text-[11px] text-red-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                <span>{user.isSuspended ? 'الحساب موقوف مؤقتاً' : 'الاشتراك منتهي الصلاحية'}</span>
              </div>
              <p className="text-[10px] leading-tight text-red-200/80">
                تم إيقاف العمليات والمزامنة والذكاء الاصطناعي لحين تجديد الاشتراك.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  {user.plan_tier === 'pro' ? 'باقة برو (Pro)' : 'باقة بلس (Plus)'}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
                >
                  {user.billing_cycle === 'monthly' ? 'شهري' : 'سنوي'}
                </span>
              </div>

              {user.role !== 'admin' && (
                <div className="space-y-1">
                  <div
                    className="flex items-center justify-between text-[10px]"
                    style={{ color: 'rgba(255,255,255,0.75)' }}
                  >
                    <span>رصيد التحليل الشهري</span>
                    <span className="font-mono font-bold text-amber-300">
                      {user.ai_usage_count || 0} / {user.ai_quota_limit || 50}
                    </span>
                  </div>
                  <div
                    className="w-full h-1.5 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.1)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.round(((user.ai_usage_count || 0) / (user.ai_quota_limit || 50)) * 100))}%`,
                        background:
                          (user.ai_usage_count || 0) >= (user.ai_quota_limit || 50)
                            ? '#ef4444'
                            : '#B88A3B',
                      }}
                    />
                  </div>
                  {user.ai_renewal_date && (
                    <p className="text-[9px] text-white/50">
                      يتجدد الرصيد تلقائياً: {String(user.ai_renewal_date).slice(0, 10)}
                    </p>
                  )}
                </div>
              )}

              <div
                className="flex items-center gap-1.5 text-[10px] pt-0.5"
                style={{ color: 'rgba(255,255,255,0.75)' }}
                data-testid="sidebar-connection-status"
              >
                {renderConnectionBadge()}
              </div>
            </>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div
        className="p-3 space-y-1"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
      >
        <button
          type="button"
          onClick={toggleTheme}
          aria-pressed={theme === 'dark'}
          aria-label="تبديل المظهر الفاتح والداكن"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer"
          style={{ color: 'rgba(255,255,255,0.7)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)';
            (e.currentTarget as HTMLButtonElement).style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '';
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)';
          }}
          data-testid="button-toggle-theme"
        >
          {theme === 'light' ? (
            <>
              <Moon className="w-4 h-4 shrink-0" />
              الوضع الداكن
            </>
          ) : (
            <>
              <Sun className="w-4 h-4 shrink-0" />
              الوضع الفاتح
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleLogout}
          disabled={logoutMutation.isPending}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-40 cursor-pointer"
          style={{ color: 'rgba(255,180,180,0.85)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.18)';
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(252,165,165,1)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '';
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,180,180,0.85)';
          }}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {logoutMutation.isPending ? 'جارٍ الخروج...' : 'تسجيل الخروج'}
        </button>
      </div>
    </div>
  );
}
