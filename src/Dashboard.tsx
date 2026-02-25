import React from 'react';
import MetricCard from './components/MetricCard';
import PageHeader from './components/PageHeader';

const departments = [
  {
    name: 'Business Intelligence',
    description: 'Analytics, KPIs, and data insights',
    path: '/ops/bi',
    icon: '📊',
    color: 'bg-blue-50 border-blue-200',
  },
  {
    name: 'Sales',
    description: 'Pipeline, orders, and revenue tracking',
    path: '/ops/sales',
    icon: '💰',
    color: 'bg-green-50 border-green-200',
  },
  {
    name: 'Marketing',
    description: 'GA4 analytics, campaigns, and SEO',
    path: '/ops/marketing',
    icon: '📣',
    color: 'bg-yellow-50 border-yellow-200',
  },
  {
    name: 'IT',
    description: 'Infrastructure and integrations',
    path: '/ops/it',
    icon: '🖥️',
    color: 'bg-purple-50 border-purple-200',
  },
  {
    name: 'Finance',
    description: 'Xero invoicing and financial reports',
    path: '/ops/finance',
    icon: '🧾',
    color: 'bg-red-50 border-red-200',
  },
  {
    name: 'Content',
    description: 'Publishing schedule and asset management',
    path: '/ops/content',
    icon: '📝',
    color: 'bg-indigo-50 border-indigo-200',
  },
];

const Dashboard: React.FC = () => {
  return (
    <div className="p-8">
      <PageHeader
        title="GCI Command Center"
        description="Unified operations dashboard for GCI Tires"
      />

      {/* Quick metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard title="Today's Orders" value="—" subtitle="Shopify" icon="🛒" />
        <MetricCard title="Revenue (30d)" value="—" subtitle="Shopify" icon="💵" />
        <MetricCard title="Website Sessions" value="—" subtitle="GA4 · last 7 days" icon="👀" />
        <MetricCard title="Outstanding Invoices" value="—" subtitle="Xero" icon="📋" />
      </div>

      {/* Department grid */}
      <h2 className="text-lg font-semibold text-gray-700 mb-4">Departments</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {departments.map(dept => (
          <a
            key={dept.path}
            href={dept.path}
            className={`block rounded-xl border p-5 hover:shadow-md transition-shadow ${dept.color}`}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{dept.icon}</span>
              <h3 className="font-semibold text-gray-800">{dept.name}</h3>
            </div>
            <p className="text-sm text-gray-500">{dept.description}</p>
          </a>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
