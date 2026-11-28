import { lazy, Suspense, useState } from 'react';
import type { translator } from './labels';
import type { useWorkbench } from './useWorkbench';
import './review-dispatch.css';

const EmailDrafts = lazy(() => import('./EmailDrafts'));
const RedactedReview = lazy(() => import('./RedactedReview'));

export default function ReviewAndDispatchOptions({ desk, language: { arabic, labels } }: {
  desk: ReturnType<typeof useWorkbench>;
  language: ReturnType<typeof translator>;
}) {
  const [draftsOpened, setDraftsOpened] = useState(false);
  const [reviewOpened, setReviewOpened] = useState(false);
  const loading = <p className="quiet" role="status">{labels.loading}</p>;

  return <>
    <details className="review-dispatch" data-testid="email-drafts-panel" onToggle={(event) => {
      if (event.currentTarget.open) setDraftsOpened(true);
    }}>
      <summary data-testid="email-drafts-toggle">
        {arabic ? 'مسودات البريد الإلكتروني' : 'Email drafts'} <bdi dir="ltr">(.eml)</bdi>
      </summary>
      {draftsOpened && <Suspense fallback={loading}><EmailDrafts desk={desk} arabic={arabic} /></Suspense>}
    </details>
    <details className="review-dispatch" data-testid="redacted-review-panel" onToggle={(event) => {
      if (event.currentTarget.open) setReviewOpened(true);
    }}>
      <summary data-testid="redacted-review-toggle">{arabic ? 'نسخ المراجعة المحجوبة' : 'Redacted review'}</summary>
      {reviewOpened && <Suspense fallback={loading}><RedactedReview desk={desk} arabic={arabic} /></Suspense>}
    </details>
  </>;
}
