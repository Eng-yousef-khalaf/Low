import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TeamMemberItem {
  id: string;
  name: string;
  username: string;
  role: 'manager' | 'lawyer' | 'paralegal' | 'accountant';
  status: 'active' | 'inactive';
}

export interface TeamMemberSelectProps {
  id?: string;
  label?: string;
  value: string;
  assigneeId?: string | null;
  onChange: (assigneeName: string, assigneeId?: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  manager: 'مدير المكتب',
  lawyer: 'محامي',
  paralegal: 'مساعد قانوني',
  accountant: 'محاسب',
};

/**
 * Reusable Office Team Assignee Selector (Audit Finding #44):
 * Fetches active members from `/api/team` (strictly scoped to the user's office)
 * and provides a native accessible `<select>` + custom text fallback.
 */
export function TeamMemberSelect({
  id,
  label,
  value,
  onChange,
  placeholder = 'اختر من فريق المكتب أو اكتب الاسم...',
  disabled = false,
}: TeamMemberSelectProps) {
  const { data: members = [] } = useQuery<TeamMemberItem[]>({
    queryKey: ['/api/team'],
    queryFn: async () => {
      const res = await fetch('/api/team', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const activeMembers = members.filter((m) => m.status === 'active');
  const listId = `${id || 'team-assignee'}-datalist`;

  return (
    <div className="space-y-1.5">
      {label && (
        <Label htmlFor={id} className="text-xs font-semibold">
          {label}
        </Label>
      )}
      {activeMembers.length > 0 && (
        <select
          aria-label="اختيار المكلف من فريق المكتب"
          disabled={disabled}
          value={
            activeMembers.some((m) => m.name === value) ? value : '__custom__'
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === '__custom__') return;
            const found = activeMembers.find((m) => m.name === val);
            onChange(val, found?.id);
          }}
          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-2xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="__custom__">-- اختر عضو الفريق ({activeMembers.length}) أو أدخل اسماً بالأسفل --</option>
          {activeMembers.map((m) => (
            <option key={m.id} value={m.name}>
              {m.name} ({ROLE_LABELS[m.role] || m.role})
            </option>
          ))}
        </select>
      )}

      <Input
        id={id}
        list={listId}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          const nextName = e.target.value;
          const found = activeMembers.find((m) => m.name === nextName);
          onChange(nextName, found?.id);
        }}
      />
      <datalist id={listId}>
        {activeMembers.map((m) => (
          <option key={m.id} value={m.name}>
            {ROLE_LABELS[m.role] || m.role}
          </option>
        ))}
      </datalist>
    </div>
  );
}
