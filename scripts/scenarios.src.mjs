// P0 交互剧本：只覆盖 03_ticket_v1 的 13 道题。
// 原则：不手抄模板 —— 在原始 lib.rs 上做锚点替换，测试代码保持与仓库逐字一致。
// mode: slots（把芯片填进空位） / toggle（点一下切换可见性等） / editor（自由写）

const L = (...lines) => lines.join('\n');

export const SCENARIOS = {
  '03_ticket_v1/00_intro': {
    mode: 'slots',
    label: '填词',
    edits: [[`    "I'm ready to __!"`, `    "I'm ready to {{word}}!"`]],
    slots: [
      {
        key: 'word',
        label: '补全这句话',
        answer: 'start modelling a software ticket',
        options: ['start modelling a software ticket', 'start', 'model tickets'],
      },
    ],
  },

  '03_ticket_v1/01_struct': {
    mode: 'slots',
    label: '从零拼装',
    // 原题没有起始代码，这里给一副骨架，让你只做「类型 + 判断」两个决定
    base: L(
      'struct Order {',
      '    price: {{price_ty}},',
      '    quantity: {{qty_ty}},',
      '}',
      '',
      'impl Order {',
      '    fn is_available(&self) -> bool {',
      '        {{cond}}',
      '    }',
      '}',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    use super::*;',
      '',
      '    #[test]',
      '    fn test_order_is_available() {',
      '        let order = Order {',
      '            price: 100,',
      '            quantity: 10,',
      '        };',
      '        assert!(order.is_available());',
      '    }',
      '',
      '    #[test]',
      '    fn test_order_is_not_available() {',
      '        let order = Order {',
      '            price: 100,',
      '            quantity: 0,',
      '        };',
      '        assert!(!order.is_available());',
      '    }',
      '}'
    ),
    slots: [
      { key: 'price_ty', label: 'price 的类型', answer: 'u32', options: ['u32', 'String', 'bool'] },
      { key: 'qty_ty', label: 'quantity 的类型', answer: 'u32', options: ['u32', 'String', 'bool'] },
      {
        key: 'cond',
        label: '可售判断',
        answer: 'self.quantity > 0',
        options: ['self.quantity > 0', 'self.price > 0', 'self.quantity == 0', 'self.quantity >= 0'],
      },
    ],
  },

  '03_ticket_v1/02_validation': {
    mode: 'slots',
    label: '校验流水线',
    edits: [
      [
        '        todo!();',
        L(
          '        if {{c1}} {',
          '            panic!("Title cannot be empty");',
          '        }',
          '        if title.len() > {{n1}} {',
          '            panic!("Title cannot be longer than 50 bytes");',
          '        }',
          '        if {{c2}} {',
          '            panic!("Description cannot be empty");',
          '        }',
          '        if description.len() > {{n2}} {',
          '            panic!("Description cannot be longer than 500 bytes");',
          '        }',
          '        if {{c3}} {',
          '            panic!("Only `To-Do`, `In Progress`, and `Done` statuses are allowed");',
          '        }',
          ''
        ),
      ],
    ],
    slots: [
      {
        key: 'c1',
        label: '标题为空',
        answer: 'title.is_empty()',
        options: ['title.is_empty()', 'title.is_empty', 'title.len() > 0'],
      },
      { key: 'n1', label: '标题上限', answer: '50', options: ['50', '500', '1000'] },
      {
        key: 'c2',
        label: '描述为空',
        answer: 'description.is_empty()',
        options: ['description.is_empty()', 'description.is_empty', 'description.len() < 0'],
      },
      { key: 'n2', label: '描述上限', answer: '500', options: ['500', '50', '5000'] },
      {
        key: 'c3',
        label: '合法状态',
        answer: 'status != "To-Do" && status != "In Progress" && status != "Done"',
        options: [
          'status != "To-Do" && status != "In Progress" && status != "Done"',
          'status == "To-Do" && status == "In Progress" && status == "Done"',
          'status != "To-Do" || status != "In Progress" || status != "Done"',
        ],
      },
    ],
  },

  '03_ticket_v1/03_modules': {
    mode: 'slots',
    label: '模块路径',
    edits: [
      [
        L(
          '    // TODO: Make this code compile, either by adding a `use` statement or by using',
          '    //  the appropriate path to refer to the `Ticket` struct.'
        ),
        '    {{use_stmt}}',
      ],
    ],
    slots: [
      {
        key: 'use_stmt',
        label: '怎么引用父模块的 Ticket',
        answer: 'use super::Ticket;',
        options: ['use super::Ticket;', 'use self::Ticket;', 'use Ticket;'],
      },
    ],
  },

  '03_ticket_v1/04_visibility': {
    mode: 'toggle',
    label: '可见性开关',
    // 原题要求先观察编译错误再注释掉两行，网页版把观察函数移除了，只保留可见性决策
    base: L(
      'mod ticket {',
      '    {{s}}struct Ticket {',
      '        title: String,',
      '        description: String,',
      '        status: String,',
      '    }',
      '',
      '    impl Ticket {',
      '        {{f}}fn new(title: String, description: String, status: String) -> Ticket {',
      '            if title.is_empty() {',
      '                panic!("Title cannot be empty");',
      '            }',
      '            if title.len() > 50 {',
      '                panic!("Title cannot be longer than 50 bytes");',
      '            }',
      '            if description.is_empty() {',
      '                panic!("Description cannot be empty");',
      '            }',
      '            if description.len() > 500 {',
      '                panic!("Description cannot be longer than 500 bytes");',
      '            }',
      '            if status != "To-Do" && status != "In Progress" && status != "Done" {',
      '                panic!("Only `To-Do`, `In Progress`, and `Done` statuses are allowed");',
      '            }',
      '',
      '            Ticket {',
      '                title,',
      '                description,',
      '                status,',
      '            }',
      '        }',
      '    }',
      '}',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    // 原题在这里放了两个「应当编译失败」的观察函数，网页版移除；',
      '    // 这一行 use 就是核心考点：只有 struct 和 fn 都 pub 时才编译得过。',
      '    #[allow(unused_imports)]',
      '    use super::ticket::Ticket;',
      '}'
    ),
    slots: [
      { key: 's', label: 'struct Ticket', answer: 'pub ', options: ['', 'pub '] },
      { key: 'f', label: 'fn new', answer: 'pub ', options: ['', 'pub '] },
    ],
  },

  '03_ticket_v1/05_encapsulation': {
    mode: 'slots',
    label: '补三个取值方法',
    edits: [
      [
        L(
          '        // TODO: Add three public methods to the `Ticket` struct:',
          '        //  - `title` that returns the `title` field.',
          '        //  - `description` that returns the `description` field.',
          '        //  - `status` that returns the `status` field.'
        ),
        L(
          '        pub fn title(&self) -> &String {',
          '            {{t}}',
          '        }',
          '',
          '        pub fn description(&self) -> &String {',
          '            {{d}}',
          '        }',
          '',
          '        pub fn status(&self) -> &String {',
          '            {{s}}',
          '        }'
        ),
      ],
    ],
    slots: [
      { key: 't', label: 'title 的返回值', answer: '&self.title', options: ['&self.title', 'self.title', '&self'] },
      { key: 'd', label: 'description 的返回值', answer: '&self.description', options: ['&self.description', 'self.description', '&self'] },
      { key: 's', label: 'status 的返回值', answer: '&self.status', options: ['&self.status', 'self.status', '&self'] },
    ],
  },

  '03_ticket_v1/06_ownership': { mode: 'editor', label: '自由编辑' },
  '03_ticket_v1/07_setters': { mode: 'editor', label: '自由编辑' },
  '03_ticket_v1/12_outro': { mode: 'editor', label: '自由编辑' },

  '03_ticket_v1/08_stack': {
    mode: 'slots',
    label: '栈上占几字节',
    edits: [
      ['        assert_eq!(size_of::<u16>(), todo!());', '        assert_eq!(size_of::<u16>(), {{a}});'],
      ['        assert_eq!(size_of::<i32>(), todo!());', '        assert_eq!(size_of::<i32>(), {{b}});'],
      ['        assert_eq!(size_of::<bool>(), todo!());', '        assert_eq!(size_of::<bool>(), {{c}});'],
    ],
    slots: [
      { key: 'a', label: 'u16', answer: '2', options: ['2', '4', '8'] },
      { key: 'b', label: 'i32', answer: '4', options: ['2', '4', '8'] },
      { key: 'c', label: 'bool', answer: '1', options: ['1', '2', '4'] },
    ],
  },

  '03_ticket_v1/09_heap': {
    mode: 'slots',
    label: '堆上占几字节',
    edits: [
      ['        assert_eq!(size_of::<String>(), todo!());', '        assert_eq!(size_of::<String>(), {{a}});'],
      ['        assert_eq!(size_of::<Ticket>(), todo!());', '        assert_eq!(size_of::<Ticket>(), {{b}});'],
    ],
    slots: [
      { key: 'a', label: 'String', answer: '24', options: ['24', '8', '32'] },
      { key: 'b', label: 'Ticket（三个 String）', answer: '72', options: ['72', '24', '48'] },
    ],
  },

  '03_ticket_v1/10_references_in_memory': {
    mode: 'slots',
    label: '引用也是值',
    edits: [
      ['        assert_eq!(size_of::<&u16>(), todo!());', '        assert_eq!(size_of::<&u16>(), {{a}});'],
      ['        assert_eq!(size_of::<&mut u64>(), todo!());', '        assert_eq!(size_of::<&mut u64>(), {{b}});'],
      ['        assert_eq!(size_of::<&Ticket>(), todo!());', '        assert_eq!(size_of::<&Ticket>(), {{c}});'],
    ],
    slots: [
      { key: 'a', label: '&u16', answer: '8', options: ['8', '4', '16'] },
      { key: 'b', label: '&mut u64', answer: '8', options: ['8', '4', '16'] },
      { key: 'c', label: '&Ticket', answer: '8', options: ['8', '4', '16'] },
    ],
  },

  '03_ticket_v1/11_destructor': {
    mode: 'slots',
    label: '填词',
    edits: [['    "I have a basic understanding of __!"', '    "I have a basic understanding of {{word}}!"']],
    slots: [
      {
        key: 'word',
        label: '补全这句话',
        answer: 'destructors',
        options: ['destructors', 'destructor', 'drop', 'Drop'],
      },
    ],
  },
};
