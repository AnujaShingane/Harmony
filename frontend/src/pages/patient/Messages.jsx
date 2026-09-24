import { useEffect, useState } from 'react';
import { usePatientSession } from '../../hooks/usePatientSession';
import PatientDashboardLayout from '../../components/layout/PatientDashboardLayout';
import { PortalLoading, PortalError } from '../../components/layout/PortalStatus';
import { Card, EmptyState } from '../../components/ui/PatientKit';
import WhatsAppChat from '../../components/chat/WhatsAppChat';
import { getCurrentTherapistId, getOrCreateConversation, getTherapistDetail } from '../../services/api';

export default function Messages() {
  const { user, loading, error, reload, logout } = usePatientSession();
  const [conversation, setConversation] = useState(null);
  const [therapist, setTherapist] = useState(null);
  const [hasTherapist, setHasTherapist] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    getCurrentTherapistId(user.id)
      .then(async (therapistId) => {
        if (!therapistId) { setHasTherapist(false); return; }
        setHasTherapist(true);
        const t = await getTherapistDetail(therapistId).catch(() => null);
        setTherapist(t);
        const convo = await getOrCreateConversation(user.id, user.full_name || user.name, therapistId, t?.name || 'Your Therapist');
        setConversation({ ...convo, id: convo.id || convo._id });
      })
      .catch((err) => console.error('Failed to load conversation:', err));
  }, [user?.id]);

  if (loading) return <PortalLoading />;
  if (error) return <PortalError message={error} onRetry={reload} onLogout={logout} />;

  return (
    <PatientDashboardLayout active="messages" user={user} onLogout={logout} search={{ placeholder: 'Search your therapist or a message', value: query, onChange: setQuery }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
        <p className="text-slate-500 text-sm mt-1">Chat directly with your therapist.</p>
      </div>

      {hasTherapist === false ? (
        <Card>
          <EmptyState title="No conversation yet" subtitle="Once you've booked a session, you'll be able to message your therapist here." />
        </Card>
      ) : !conversation ? null : (
        <WhatsAppChat
          highlight={query}
          conversation={conversation}
          me="patient"
          title={therapist?.name || 'Your Therapist'}
          subtitle={therapist?.profile?.profession || 'Care team'}
          avatarUrl={therapist?.avatarUrl}
        />
      )}
    </PatientDashboardLayout>
  );
}
