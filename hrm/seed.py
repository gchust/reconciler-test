"""Seed test data for Human Resource Management."""
from nb import NocoBase
nb = NocoBase()

def create(coll, records):
    for r in records:
        nb.s.post(f'{nb.base}/api/{coll}:create', json=r, timeout=30)
    print(f'  + {coll}: {len(records)} records')

create('hrm_departments', [
    {"code":"D-001","name":"Engineering","manager":"Zhang Wei","parent_dept":"","headcount":5,"budget":120000,"status":"Active"},
    {"code":"D-002","name":"Marketing","manager":"Li Na","parent_dept":"","headcount":3,"budget":80000,"status":"Active"},
    {"code":"D-003","name":"Finance","manager":"Wang Jun","parent_dept":"","headcount":3,"budget":60000,"status":"Active"},
    {"code":"D-004","name":"Human Resources","manager":"Chen Mei","parent_dept":"","headcount":2,"budget":50000,"status":"Active"},
    {"code":"D-005","name":"Operations","manager":"Liu Yang","parent_dept":"","headcount":2,"budget":45000,"status":"Inactive"},
])

create('hrm_employees', [
    {"emp_code":"E-001","name":"Zhang Wei","department":"Engineering","position":"Tech Lead","hire_date":"2020-03-15","status":"Active","gender":"Male","phone":"13800001001","email":"zhang.wei@company.com","emergency_contact":"Zhang Li 13900001001","salary":25000,"bank_account":"6222 **** 1001"},
    {"emp_code":"E-002","name":"Li Na","department":"Marketing","position":"Marketing Director","hire_date":"2019-07-01","status":"Active","gender":"Female","phone":"13800001002","email":"li.na@company.com","emergency_contact":"Li Ming 13900001002","salary":22000,"bank_account":"6222 **** 1002"},
    {"emp_code":"E-003","name":"Wang Jun","department":"Finance","position":"Finance Manager","hire_date":"2021-01-10","status":"Active","gender":"Male","phone":"13800001003","email":"wang.jun@company.com","emergency_contact":"Wang Fang 13900001003","salary":20000,"bank_account":"6222 **** 1003"},
    {"emp_code":"E-004","name":"Chen Mei","department":"Human Resources","position":"HR Manager","hire_date":"2021-06-15","status":"Active","gender":"Female","phone":"13800001004","email":"chen.mei@company.com","emergency_contact":"Chen Hua 13900001004","salary":18000,"bank_account":"6222 **** 1004"},
    {"emp_code":"E-005","name":"Liu Yang","department":"Engineering","position":"Senior Developer","hire_date":"2022-02-20","status":"Active","gender":"Male","phone":"13800001005","email":"liu.yang@company.com","emergency_contact":"Liu Jie 13900001005","salary":18000,"bank_account":"6222 **** 1005"},
    {"emp_code":"E-006","name":"Zhao Ting","department":"Engineering","position":"Developer","hire_date":"2023-04-01","status":"Active","gender":"Female","phone":"13800001006","email":"zhao.ting@company.com","emergency_contact":"Zhao Qiang 13900001006","salary":12000,"bank_account":"6222 **** 1006"},
    {"emp_code":"E-007","name":"Sun Hao","department":"Marketing","position":"Marketing Specialist","hire_date":"2023-08-15","status":"Active","gender":"Male","phone":"13800001007","email":"sun.hao@company.com","emergency_contact":"Sun Wei 13900001007","salary":10000,"bank_account":"6222 **** 1007"},
    {"emp_code":"E-008","name":"Zhou Xin","department":"Finance","position":"Accountant","hire_date":"2022-11-01","status":"On Leave","gender":"Female","phone":"13800001008","email":"zhou.xin@company.com","emergency_contact":"Zhou Min 13900001008","salary":9000,"bank_account":"6222 **** 1008"},
    {"emp_code":"E-009","name":"Wu Gang","department":"Engineering","position":"Junior Developer","hire_date":"2024-01-15","status":"Active","gender":"Male","phone":"13800001009","email":"wu.gang@company.com","emergency_contact":"Wu Li 13900001009","salary":8000,"bank_account":"6222 **** 1009"},
    {"emp_code":"E-010","name":"Zheng Yu","department":"Marketing","position":"Designer","hire_date":"2024-06-01","status":"Active","gender":"Female","phone":"13800001010","email":"zheng.yu@company.com","emergency_contact":"Zheng Hua 13900001010","salary":11000,"bank_account":"6222 **** 1010"},
    {"emp_code":"E-011","name":"Huang Lei","department":"Engineering","position":"DevOps Engineer","hire_date":"2023-10-01","status":"Active","gender":"Male","phone":"13800001011","email":"huang.lei@company.com","emergency_contact":"Huang Mei 13900001011","salary":15000,"bank_account":"6222 **** 1011"},
    {"emp_code":"E-012","name":"Xu Fang","department":"Human Resources","position":"HR Assistant","hire_date":"2024-03-01","status":"Active","gender":"Female","phone":"13800001012","email":"xu.fang@company.com","emergency_contact":"Xu Qiang 13900001012","salary":7000,"bank_account":"6222 **** 1012"},
    {"emp_code":"E-013","name":"Ma Chao","department":"Finance","position":"Financial Analyst","hire_date":"2023-05-15","status":"Active","gender":"Male","phone":"13800001013","email":"ma.chao@company.com","emergency_contact":"Ma Li 13900001013","salary":13000,"bank_account":"6222 **** 1013"},
    {"emp_code":"E-014","name":"Gao Shan","department":"Operations","position":"Operations Lead","hire_date":"2021-09-01","status":"Resigned","gender":"Male","phone":"13800001014","email":"gao.shan@company.com","emergency_contact":"Gao Wei 13900001014","salary":16000,"bank_account":"6222 **** 1014"},
    {"emp_code":"E-015","name":"Lin Yue","department":"Operations","position":"Logistics Coordinator","hire_date":"2022-07-01","status":"Terminated","gender":"Female","phone":"13800001015","email":"lin.yue@company.com","emergency_contact":"Lin Jie 13900001015","salary":9500,"bank_account":"6222 **** 1015"},
])

create('hrm_attendance', [
    {"emp_name":"Zhang Wei","date":"2026-04-01","check_in":"08:55","check_out":"18:10","status":"Present","work_hours":8.5,"overtime_hours":0.5,"remark":""},
    {"emp_name":"Li Na","date":"2026-04-01","check_in":"09:05","check_out":"18:00","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Wang Jun","date":"2026-04-01","check_in":"09:15","check_out":"17:30","status":"Late","work_hours":7.5,"overtime_hours":0,"remark":"Traffic delay"},
    {"emp_name":"Chen Mei","date":"2026-04-01","check_in":"08:50","check_out":"18:30","status":"Present","work_hours":9,"overtime_hours":1,"remark":""},
    {"emp_name":"Liu Yang","date":"2026-04-01","check_in":"","check_out":"","status":"Absent","work_hours":0,"overtime_hours":0,"remark":"No show"},
    {"emp_name":"Zhao Ting","date":"2026-04-01","check_in":"08:58","check_out":"18:05","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Sun Hao","date":"2026-04-01","check_in":"","check_out":"","status":"Leave","work_hours":0,"overtime_hours":0,"remark":"Annual leave"},
    {"emp_name":"Zhou Xin","date":"2026-04-01","check_in":"","check_out":"","status":"Leave","work_hours":0,"overtime_hours":0,"remark":"Maternity leave"},
    {"emp_name":"Wu Gang","date":"2026-04-01","check_in":"09:00","check_out":"20:00","status":"Present","work_hours":10,"overtime_hours":2,"remark":"Project deadline"},
    {"emp_name":"Zheng Yu","date":"2026-04-01","check_in":"09:02","check_out":"18:00","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Zhang Wei","date":"2026-04-02","check_in":"08:45","check_out":"18:00","status":"Present","work_hours":8.5,"overtime_hours":0,"remark":""},
    {"emp_name":"Li Na","date":"2026-04-02","check_in":"09:00","check_out":"18:30","status":"Present","work_hours":8.5,"overtime_hours":0.5,"remark":""},
    {"emp_name":"Wang Jun","date":"2026-04-02","check_in":"08:55","check_out":"18:00","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Chen Mei","date":"2026-04-02","check_in":"08:50","check_out":"18:00","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Liu Yang","date":"2026-04-02","check_in":"09:20","check_out":"17:45","status":"Late","work_hours":7.5,"overtime_hours":0,"remark":"Overslept"},
    {"emp_name":"Zhao Ting","date":"2026-04-02","check_in":"09:00","check_out":"21:00","status":"Present","work_hours":11,"overtime_hours":3,"remark":"Release day"},
    {"emp_name":"Sun Hao","date":"2026-04-02","check_in":"","check_out":"","status":"Leave","work_hours":0,"overtime_hours":0,"remark":"Annual leave"},
    {"emp_name":"Zhou Xin","date":"2026-04-02","check_in":"","check_out":"","status":"Leave","work_hours":0,"overtime_hours":0,"remark":"Maternity leave"},
    {"emp_name":"Wu Gang","date":"2026-04-02","check_in":"08:58","check_out":"18:00","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Zheng Yu","date":"2026-04-02","check_in":"09:00","check_out":"18:00","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Zhang Wei","date":"2026-04-03","check_in":"08:50","check_out":"18:00","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Li Na","date":"2026-04-03","check_in":"","check_out":"","status":"Holiday","work_hours":0,"overtime_hours":0,"remark":"Qingming Festival"},
    {"emp_name":"Wang Jun","date":"2026-04-03","check_in":"","check_out":"","status":"Holiday","work_hours":0,"overtime_hours":0,"remark":"Qingming Festival"},
    {"emp_name":"Chen Mei","date":"2026-04-03","check_in":"","check_out":"","status":"Holiday","work_hours":0,"overtime_hours":0,"remark":"Qingming Festival"},
    {"emp_name":"Liu Yang","date":"2026-04-03","check_in":"08:55","check_out":"18:00","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Zhao Ting","date":"2026-04-03","check_in":"09:00","check_out":"17:00","status":"Present","work_hours":7,"overtime_hours":0,"remark":"Left early - doctor"},
    {"emp_name":"Huang Lei","date":"2026-04-01","check_in":"09:00","check_out":"19:00","status":"Present","work_hours":9,"overtime_hours":1,"remark":"Server maintenance"},
    {"emp_name":"Xu Fang","date":"2026-04-01","check_in":"08:55","check_out":"18:00","status":"Present","work_hours":8,"overtime_hours":0,"remark":""},
    {"emp_name":"Ma Chao","date":"2026-04-01","check_in":"09:10","check_out":"18:00","status":"Late","work_hours":8,"overtime_hours":0,"remark":"Bus delay"},
    {"emp_name":"Huang Lei","date":"2026-04-02","check_in":"","check_out":"","status":"Absent","work_hours":0,"overtime_hours":0,"remark":"Sick - no certificate"},
])

create('hrm_leave_requests', [
    {"emp_name":"Sun Hao","leave_type":"Annual","start_date":"2026-04-01","end_date":"2026-04-03","days":3,"status":"Approved","reason":"Family vacation","approver":"Li Na"},
    {"emp_name":"Zhou Xin","leave_type":"Maternity","start_date":"2026-03-01","end_date":"2026-06-30","days":120,"status":"Approved","reason":"Maternity leave","approver":"Wang Jun"},
    {"emp_name":"Liu Yang","leave_type":"Sick","start_date":"2026-04-05","end_date":"2026-04-06","days":2,"status":"Pending","reason":"Flu symptoms","approver":"Zhang Wei"},
    {"emp_name":"Zhao Ting","leave_type":"Personal","start_date":"2026-04-10","end_date":"2026-04-10","days":1,"status":"Pending","reason":"Personal errand","approver":"Zhang Wei"},
    {"emp_name":"Wu Gang","leave_type":"Annual","start_date":"2026-04-15","end_date":"2026-04-18","days":4,"status":"Pending","reason":"Travel","approver":"Zhang Wei"},
    {"emp_name":"Zheng Yu","leave_type":"Sick","start_date":"2026-03-20","end_date":"2026-03-21","days":2,"status":"Approved","reason":"Dental surgery","approver":"Li Na"},
    {"emp_name":"Xu Fang","leave_type":"Annual","start_date":"2026-05-01","end_date":"2026-05-05","days":5,"status":"Rejected","reason":"Peak season, insufficient coverage","approver":"Chen Mei"},
    {"emp_name":"Ma Chao","leave_type":"Unpaid","start_date":"2026-04-20","end_date":"2026-04-22","days":3,"status":"Cancelled","reason":"Family emergency - resolved","approver":"Wang Jun"},
])

create('hrm_payroll', [
    {"emp_name":"Zhang Wei","period":"2026-03","base_salary":25000,"overtime_pay":1500,"bonus":3000,"deductions":2500,"tax":3200,"net_pay":23800,"status":"Paid"},
    {"emp_name":"Li Na","period":"2026-03","base_salary":22000,"overtime_pay":0,"bonus":2000,"deductions":2200,"tax":2600,"net_pay":19200,"status":"Paid"},
    {"emp_name":"Wang Jun","period":"2026-03","base_salary":20000,"overtime_pay":0,"bonus":1500,"deductions":2000,"tax":2300,"net_pay":17200,"status":"Approved"},
    {"emp_name":"Chen Mei","period":"2026-03","base_salary":18000,"overtime_pay":800,"bonus":1000,"deductions":1800,"tax":2100,"net_pay":15900,"status":"Calculated"},
    {"emp_name":"Liu Yang","period":"2026-03","base_salary":18000,"overtime_pay":2000,"bonus":0,"deductions":1800,"tax":2200,"net_pay":16000,"status":"Draft"},
])

create('hrm_recruitment', [
    {"position":"Senior Frontend Developer","department":"Engineering","candidates":12,"status":"Interviewing","priority":"Urgent","posted_date":"2026-03-01","deadline":"2026-04-30","recruiter":"Chen Mei","remark":"React + TypeScript required"},
    {"position":"Marketing Analyst","department":"Marketing","candidates":8,"status":"Screening","priority":"High","posted_date":"2026-03-15","deadline":"2026-05-15","recruiter":"Xu Fang","remark":"Data analysis experience preferred"},
    {"position":"Junior Accountant","department":"Finance","candidates":5,"status":"Open","priority":"Normal","posted_date":"2026-04-01","deadline":"2026-05-31","recruiter":"Chen Mei","remark":"CPA certification a plus"},
    {"position":"DevOps Engineer","department":"Engineering","candidates":3,"status":"Offer","priority":"High","posted_date":"2026-02-15","deadline":"2026-04-15","recruiter":"Xu Fang","remark":"AWS/K8s experience required"},
    {"position":"HR Intern","department":"Human Resources","candidates":15,"status":"Closed","priority":"Low","posted_date":"2026-01-10","deadline":"2026-03-01","recruiter":"Chen Mei","remark":"Summer internship position"},
    {"position":"Backend Developer","department":"Engineering","candidates":0,"status":"Open","priority":"Normal","posted_date":"2026-04-05","deadline":"2026-06-30","recruiter":"Xu Fang","remark":"Go/Python, microservices experience"},
])

print(f'\nTotal: 69 records seeded')
