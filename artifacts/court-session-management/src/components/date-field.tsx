import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  normalizeArabicDigits,
  validateDateInput,
  type CalendarType,
} from '@/lib/date-validation';

export interface DateFieldProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (normalizedValue: string) => void;
  defaultCalendar?: CalendarType;
  allowCalendarToggle?: boolean;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Unified Court Date Input Component (Audit Finding #42):
 * - Automatically converts Eastern Arabic (`٠-٩`) and Persian (`۰-۹`) digits to standard digits as the user types.
 * - Supports toggling between Hijri (`هجري`) and Gregorian (`ميلادي`) validation & hints.
 * - Preserves user input on error (never clears the field!).
 */
export function DateField({
  id,
  label,
  value,
  onChange,
  defaultCalendar = 'hijri',
  allowCalendarToggle = true,
  placeholder,
  required = false,
  disabled = false,
  className = '',
}: DateFieldProps) {
  const [calendar, setCalendar] = useState<CalendarType>(() => {
    const clean = normalizeArabicDigits(value);
    if (/\b(19|20)\d{2}\b/.test(clean)) return 'gregorian';
    return defaultCalendar;
  });
  const [touched, setTouched] = useState(false);

  const validation = value.trim()
    ? validateDateInput(value, calendar)
    : { isValid: !required };

  const effectivePlaceholder =
    placeholder || (calendar === 'hijri' ? '15/02/1448' : '25/10/2026');

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <Label htmlFor={id} className="text-xs font-semibold">
          {label}
        </Label>
      )}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Input
            id={id}
            dir="ltr"
            inputMode="numeric"
            value={value}
            disabled={disabled}
            required={required}
            placeholder={effectivePlaceholder}
            onChange={(e) => {
              const converted = normalizeArabicDigits(e.target.value);
              onChange(converted);
            }}
            onBlur={() => {
              setTouched(true);
              if (value.trim()) {
                const res = validateDateInput(value, calendar);
                if (res.isValid && res.normalized && res.normalized !== value) {
                  onChange(res.normalized);
                }
              }
            }}
            className={`text-left font-mono pr-8 ${
              touched && value.trim() && !validation.isValid
                ? 'border-destructive focus-visible:ring-destructive'
                : ''
            }`}
          />
          <CalendarDays className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {allowCalendarToggle && (
          <div
            className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 shrink-0"
            role="group"
            aria-label="نوع التقويم"
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCalendar('hijri')}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                calendar === 'hijri'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              هجري
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCalendar('gregorian')}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                calendar === 'gregorian'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ميلادي
            </button>
          </div>
        )}
      </div>

      {touched && value.trim() && !validation.isValid && validation.message && (
        <p className="text-xs text-destructive font-medium" role="alert">
          {validation.message}
        </p>
      )}
    </div>
  );
}
