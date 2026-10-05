import EmployeeTabs from '@/components/employee-tabs';
import { AccessGate } from '@/components/access-gate';
import { ConsentGate } from '@/components/consent-gate';
import { useWarmTabs } from '@/hooks/use-warm-tabs';

export default function EmployeeLayout() {
  useWarmTabs();
  // The gate shows nothing to an employee: a week after his employer was
  // stopped it signs him out, and until then it is not there at all.
  return <AccessGate><ConsentGate><EmployeeTabs /></ConsentGate></AccessGate>;
}
