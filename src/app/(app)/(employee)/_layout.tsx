import EmployeeTabs from '@/components/employee-tabs';
import { ConsentGate } from '@/components/consent-gate';
import { useWarmTabs } from '@/hooks/use-warm-tabs';

export default function EmployeeLayout() {
  useWarmTabs();
  return <ConsentGate><EmployeeTabs /></ConsentGate>;
}
