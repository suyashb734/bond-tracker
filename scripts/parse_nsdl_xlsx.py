import sys, json, zipfile, re
import xml.etree.ElementTree as ET

def parse_xlsx_xml(file_path):
    rows = []
    try:
        with zipfile.ZipFile(file_path, 'r') as z:
            # Read shared strings
            shared_strings = []
            if 'xl/sharedStrings.xml' in z.namelist():
                ss_tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
                for si in ss_tree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                    t = ''.join(si.itertext())
                    shared_strings.append(t.strip())

            # Read worksheet 1
            ws_xml = z.read('xl/worksheets/sheet1.xml')
            ws_tree = ET.fromstring(ws_xml)
            ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

            for row in ws_tree.findall('.//s:row', ns):
                cells = []
                for c in row.findall('s:c', ns):
                    cell_type = c.get('t')
                    val_elem = c.find('s:v', ns)
                    val = val_elem.text.strip() if val_elem is not None and val_elem.text else ''

                    if cell_type == 's' and val.isdigit():
                        idx = int(val)
                        if 0 <= idx < len(shared_strings):
                            val = shared_strings[idx]

                    cells.append(val)

                # Look for ISIN token in cells
                isin = None
                for cell in cells:
                    clean = cell.strip().upper()
                    if re.match(r'^IN[A-Z0-9]{10}$', clean):
                        isin = clean
                        break

                if isin:
                    rows.append({
                        'isin': isin,
                        'row_values': cells
                    })
    except Exception as e:
        return {'error': str(e)}

    return rows

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps([]))
        sys.exit(0)

    res = parse_xlsx_xml(sys.argv[1])
    print(json.dumps(res))
