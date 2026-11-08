import { Link } from 'react-router-dom';
import CategoryList from '../components/CategoryList';

/**
 * Settings → Categories as a full page (`/settings/categories`): the grouped list
 * outgrew a modal. Merchants and Tags still open in modals from Settings.
 */
export default function Categories() {
  return (
    <section>
      <Link to="/settings" className="back-link">
        ‹ Settings
      </Link>
      <header className="page-head">
        <h1>Categories</h1>
      </header>
      <CategoryList />
    </section>
  );
}
