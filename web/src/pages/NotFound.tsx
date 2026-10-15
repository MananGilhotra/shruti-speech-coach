import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <EmptyState title="Page not found" action={<Link to="/" className="link">Back to SHRUTI home</Link>}>
        There is nothing at this address.
      </EmptyState>
    </div>
  );
}
