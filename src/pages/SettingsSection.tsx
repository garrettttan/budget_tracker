import { Link } from 'react-router-dom';
import CategoryList from '../components/CategoryList';
import MerchantList from '../components/MerchantList';
import TagList from '../components/TagList';

const LISTS = { Categories: CategoryList, Merchants: MerchantList, Tags: TagList };

/**
 * Settings → Categories, Merchants or Tags as a full page
 * (`/settings/categories`, `/settings/merchants`, `/settings/tags`), with a
 * ‹ Settings link back.
 */
export default function SettingsSection({ title }: { title: keyof typeof LISTS }) {
  const List = LISTS[title];
  return (
    <section>
      <Link to="/settings" className="back-link">
        ‹ Settings
      </Link>
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <List />
    </section>
  );
}
