import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '@panacea/ui';
import { apiPost } from '../api.js';

// Shared "create a {group|role}" modal: name + description → POST endpoint, then
// invalidate the matching list query. Reused by the Groups and Roles list views.
export function CreateEntityModal({
  open,
  onClose,
  title,
  endpoint,
  invalidateKey,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  endpoint: string;
  invalidateKey: unknown[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () => apiPost(endpoint, { name, description: description || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invalidateKey });
      setName('');
      setDescription('');
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button loading={create.isPending} disabled={!name} onClick={() => create.mutate()}>
          Create
        </Button>
      }
    >
      <Input label="Name" value={name} onChange={setName} />
      <Input label="Description" value={description} onChange={setDescription} />
    </Modal>
  );
}
