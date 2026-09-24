import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { submitTherapistSurvey, completeTherapistProfile } from '../../services/api';
import { GENDER_OPTIONS, QUALIFICATION_OPTIONS } from '../../constants/options';
import { isValidPhone } from '../../utils/phone';
import { PageShell, Card, SectionHeading, PrimaryButton, TextField, SelectField, TextAreaField } from '../../components/ui/Kit';
import BackButton from '../../components/layout/BackButton';

const TEAL = '#0d5239';
const CREAM = '#F6F4EC';

// Therapist demographic form, shown once after sign-up. Submitting takes the
// therapist straight to their console — the console stays locked with a
// "not approved yet" banner until Anahat Admin approves the account.
export default function TherapistOnboardingSurvey() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const avatarInputRef = useRef(null);

  const [form, setForm] = useState({
    name: user?.name || '',
    age: '',
    address: '',
    phone: '',
    gender: '',
    yearsExperience: '',
    practiceLevel: '',
    qualification: '',
    specialization: '',
    fee: '',
    bio: '',
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onAvatar = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Profile photo must be a JPG or PNG.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Profile photo must be under 5MB.'); return; }
    setError('');
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const missing = [];
  if (!form.name.trim()) missing.push('name');
  if (!form.age) missing.push('age');
  if (!form.address.trim()) missing.push('address');
  if (!isValidPhone(form.phone)) missing.push('a valid mobile number (10-digit Indian, or international with country code)');
  if (!form.gender) missing.push('gender');
  if (form.yearsExperience === '') missing.push('years of experience');
  if (!form.practiceLevel) missing.push('your practice level');
  if (!form.qualification) missing.push('qualification');
  if (!form.specialization.trim()) missing.push('specialization');
  if (!form.fee) missing.push('session fee');

  const submit = async () => {
    if (missing.length) {
      setError(`Please fill in: ${missing.join(', ')}.`);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const [firstName, ...rest] = form.name.trim().split(/\s+/);
      const experienceYears = parseInt(form.yearsExperience, 10) || 0;
      const specializations = form.specialization.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

      const [, updatedUser] = await Promise.all([
        submitTherapistSurvey(user.id, { ...form, specializations }),
        completeTherapistProfile({
          firstName, lastName: rest.join(' '), phone: form.phone,
          age: form.age, gender: form.gender, experienceYears,
          experienceDetails: form.qualification, profession: form.qualification,
          fee: form.fee, address: form.address, bio: form.bio,
        }, avatarFile),
      ]);
      login(updatedUser);
      navigate('/therapist', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to submit your details. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell>
      <div className="max-w-3xl mx-auto px-6 py-12">
        <BackButton to="/" label="Back to home" className="mb-6" />
        <SectionHeading
          eyebrow="One-time setup"
          title="Tell us about your practice"
          subtitle="These details appear on your profile card when patients book a session."
        />

        <Card className="space-y-6">
          {/* Profile photo — optional */}
          <div className="flex items-center gap-5">
            <div className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center border-4 border-white shadow-lg shrink-0" style={{ background: CREAM, color: TEAL }}>
              {avatarPreview ? (
                <img src={avatarPreview} alt="Profile preview" className="w-full h-full object-cover" />
              ) : (
                <svg className="w-10 h-10 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">Profile photo <span className="font-normal text-slate-400">(optional)</span></p>
              <p className="text-xs text-slate-500 mb-2">Patients see this on your booking card. JPG or PNG, max 5MB.</p>
              <button type="button" onClick={() => avatarInputRef.current?.click()} className="px-4 py-2 rounded-xl border border-black/10 text-xs font-bold text-slate-700 hover:bg-black/[0.02]">
                {avatarFile ? 'Change photo' : 'Upload photo'}
              </button>
              <input ref={avatarInputRef} type="file" accept=".jpg,.jpeg,.png" onChange={onAvatar} className="hidden" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField label="Full Name" value={form.name} onChange={update('name')} placeholder="Dr. Jane Doe" />
            <TextField label="Age" type="number" min={18} value={form.age} onChange={update('age')} placeholder="Age" />
            <TextField label="Address" value={form.address} onChange={update('address')} placeholder="Clinic / practice address" className="md:col-span-2" />
            <TextField label="Contact Number" value={form.phone} onChange={update('phone')} placeholder="Mobile number (add country code if outside India)" />
            <SelectField label="Gender" value={form.gender} onChange={update('gender')} options={['', ...GENDER_OPTIONS]} />
            <TextField label="Years of Experience" type="number" min={0} value={form.yearsExperience} onChange={update('yearsExperience')} placeholder="e.g. 4" />
            <SelectField label="Practice Level" value={form.practiceLevel} onChange={update('practiceLevel')} options={['', 'Beginner', 'Moderate', 'Professional']} />
            <SelectField label="Qualification" value={form.qualification} onChange={update('qualification')} options={['', ...QUALIFICATION_OPTIONS]} />
            <TextField label="Session Fee (₹)" type="number" min={0} value={form.fee} onChange={update('fee')} placeholder="e.g. 1500" />
          </div>

          <TextAreaField
            label="Specialization"
            rows={2}
            value={form.specialization}
            onChange={update('specialization')}
            placeholder="Describe your specialization in your own words — e.g. anxiety and sleep disorders in adults, music therapy for children with special needs"
          />

          <TextAreaField
            label="Short Bio (optional)"
            rows={3}
            value={form.bio}
            onChange={update('bio')}
            placeholder="A brief professional summary patients will read on your profile."
          />

          {error && (
            <div className="py-3 px-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs text-center">{error}</div>
          )}

          <div className="flex justify-end pt-2">
            <PrimaryButton onClick={submit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit'}</PrimaryButton>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
