import EmployeeTabs from '@/components/employee-tabs';
import { ConsentGate } from '@/components/consent-gate';

export default function EmployeeLayout() {
  return <ConsentGate><EmployeeTabs /></ConsentGate>;
}
