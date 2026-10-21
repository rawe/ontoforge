import { MAX_NOTE_LENGTH } from '@/components/changesets/changesets'
import { Textarea } from '@/components/ui/textarea'

/** A changeset dialog's note: a text area with its length against the server's limit. */
export function ChangesetNoteField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-1.5 text-[12px] text-muted-foreground">
      <span>{label}</span>
      <Textarea value={value} maxLength={MAX_NOTE_LENGTH} rows={4} onChange={(e) => onChange(e.target.value)} />
      <span className="text-right tabular-nums">
        {value.length} / {MAX_NOTE_LENGTH}
      </span>
    </label>
  )
}
