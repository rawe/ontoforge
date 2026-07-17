import * as Dialog from '@radix-ui/react-dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  variant?: 'danger' | 'default';
}

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
  variant = 'danger',
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
          <Dialog.Title className="text-lg font-semibold text-gray-900">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-gray-600">
            {description}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                variant === 'danger'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
