-- pandoc-filter.lua
-- Поддержка инлайн: background-color (подсветка), class= "mark "
-- Поддержка блочных: text-align (выравнивание), background-color, class= "text-"
-- Поддержка таблиц: бордеры ТОЛЬКО у ячеек с class= "bordered ",
--                   ширины колонок через class= "col-w-N " (пропорциональные dxa),
--                   высоты строк через class= "row-h-N ",
--                   вертикальное выравнивание (vertical-align)

-- ============================================================
-- ОТЛАДКА
-- ============================================================
local function debug_el(label, el)
    local msg = string.format("[DEBUG %s] type: %s", label, el.t or "unknown")
    
    if el.attr then
        if el.attr.classes and #el.attr.classes > 0 then
            msg = msg .. " | classes: [" .. table.concat(el.attr.classes, ", ") .. "]"
        end
        if el.attr.attributes then
            for k, v in pairs(el.attr.attributes) do
                -- Обрезаем длинные стили для читаемости
                local v_short = #v > 60 and (v:sub(1, 60) .. "...") or v
                msg = msg .. string.format(" | attr[%s]: %s", k, v_short)
            end
        end
    end
    
    -- Для ячеек таблиц
    if el.alignment then
        msg = msg .. " | native_align: " .. tostring(el.alignment)
    end
    
    io.stderr:write(msg .. "\n")
end

-- ============================================================
-- Утилиты
-- ============================================================
local function parse_css(style_str)
    local styles = {}
    if not style_str then return styles end
    
    -- ОТЛАДКА: смотрим, что вообще приходит в style
    if style_str:find("align") or style_str:find("text") then
        io.stderr:write("[DEBUG parse_css] raw style: " .. style_str .. "\n")
    end

    for k, v in string.gmatch(style_str, "([^:]+):([^;]+)") do
        local key = string.lower(string.gsub(k, "^%s*(.-)%s*$", "%1"))
        local val = string.gsub(v, "^%s*(.-)%s*$", "%1")
        styles[key] = val
    end
    
    if styles["text-align"] then
        io.stderr:write("[DEBUG parse_css] parsed text-align: " .. styles["text-align"] .. "\n")
    end
    return styles
end

local function parse_align(val)
    if not val then return nil end
    val = string.lower(val)
    if val == "left" then return "left"
    elseif val == "center" then return "center"
    elseif val == "right" then return "right"
    elseif val == "justify" then return "both" 
    end
    io.stderr:write("[DEBUG parse_align] Unknown align value: " .. val .. "\n")
    return nil
end

local function hex_color(color)
    if not color then return nil end
    color = string.gsub(color, "^%s*(.-)%s*$", "%1")
    if string.sub(color, 1, 1) == "#" then
        local hex = string.sub(color, 2)
        if #hex == 3 then hex = string.gsub(hex, "(.)(.)(.)", "%1%1%2%2%3%3") end
        return string.upper(hex)
    end
    local r, g, b = string.match(color, "rgba?%s*%(%s*(%d+)%s*,%s*(%d+)%s*,%s*(%d+)")
    if r then return string.format("%02X%02X%02X", tonumber(r), tonumber(g), tonumber(b)) end
    local named = {
        red="FF0000", blue="0000FF", green="008000", black="000000",
        white="FFFFFF", yellow="FFFF00", orange="FFA500", purple="800080",
        gray="808080", grey="808080", pink="FFC0CB", cyan="00FFFF",
        magenta="FF00FF", brown="A52A2A", navy="000080", teal="008080",
        maroon="800000", olive="808000", lime="00FF00", aqua="00FFFF",
        silver="C0C0C0", fuchsia="FF00FF", gold="FFD700", coral="FF7F50",
        crimson="DC143C", indigo="4B0082", violet="EE82EE", khaki="F0E68C",
        salmon="FA8072", tomato="FF6347", turquoise="40E0D0", wheat="F5DEB3",
    }
    return named[string.lower(color)] or nil
end

local align_map = {
    left = "left", center = "center", right = "right", justify = "both",
}

local function escape_xml(text)
    text = string.gsub(text, "&", "&amp;")
    text = string.gsub(text, "<", "&lt;")
    text = string.gsub(text, ">", "&gt;")
    text = string.gsub(text, '"', "&quot;")
    return text
end

local function get_style(el)
    if not el.attr or not el.attr.attributes then return nil end
    return el.attr.attributes.style
end

local function has_class(el, class_name)
    if not el.attr or not el.attr.classes then return false end
    for _, c in ipairs(el.attr.classes) do
        if c == class_name then return true end
    end
    return false
end

local function build_rpr_elements(css)
    local rpr = {}
    local bg = css["background-color"] or css["background"]
    if bg then
        local hex = hex_color(bg)
        if hex then
            table.insert(rpr, string.format('<w:shd w:val="clear" w:color="auto" w:fill="%s"/>', hex))
        end
    end
    return rpr
end

local function inject_rpr_into_runs(runs_xml, rpr_elements)
    if #rpr_elements == 0 then return runs_xml end
    local extra = table.concat(rpr_elements)
    return runs_xml:gsub('(<w:r>)(.-)(</w:r>)', function(open, body, close)
        if body:find('<w:rPr>') then
            return open .. body:gsub('<w:rPr>', '<w:rPr>' .. extra) .. close
        else
            return open .. '<w:rPr>' .. extra .. '</w:rPr>' .. body .. close
        end
    end)
end

-- ============================================================
-- Сериализация инлайн-элементов
-- ============================================================
local function serialize_inlines(inlines)
    local parts = {}
    for _, inline in ipairs(inlines) do
        local xml = nil
        if inline.t == "Str" then
            xml = string.format('<w:r><w:t xml:space="preserve">%s</w:t></w:r>', escape_xml(inline.text))
        elseif inline.t == "Space" or inline.t == "SoftBreak" then
            xml = '<w:r><w:t xml:space="preserve"> </w:t></w:r>'
        elseif inline.t == "LineBreak" then
            xml = '<w:r><w:br/></w:r>'
        elseif inline.t == "RawInline" and inline.format == "openxml" then
            xml = inline.text
        elseif inline.t == "Emph" then
            xml = inject_rpr_into_runs(serialize_inlines(inline.content), {'<w:i/>', '<w:iCs/>'})
        elseif inline.t == "Strong" then
            xml = inject_rpr_into_runs(serialize_inlines(inline.content), {'<w:b/>', '<w:bCs/>'})
        elseif inline.t == "Strikeout" then
            xml = inject_rpr_into_runs(serialize_inlines(inline.content), {'<w:strike/>'})
        elseif inline.t == "Underline" then
            xml = inject_rpr_into_runs(serialize_inlines(inline.content), {'<w:u w:val="single"/>'})
        elseif inline.t == "Link" then
            local text = escape_xml(pandoc.utils.stringify(inline.content))
            xml = string.format(
                '<w:hyperlink w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/>' ..
                '<w:color w:val="0563C1"/> <w:u w:val="single"/> </w:rPr>' ..
                '<w:t xml:space="preserve">%s</w:t></w:r></w:hyperlink>', text
            )
        elseif inline.t == "Span" then
            xml = serialize_inlines(inline.content)
        elseif inline.t == "Code" then
            xml = string.format(
                '<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' ..
                '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/> </w:rPr>' ..
                '<w:t xml:space="preserve">%s</w:t></w:r>', escape_xml(inline.text)
            )
        elseif inline.t == "Quoted" then
            local inner = serialize_inlines(inline.content)
            xml = '<w:r><w:t xml:space="preserve">\226\128\156</w:t></w:r>' .. inner ..
                  '<w:r><w:t xml:space="preserve">\226\128\157</w:t></w:r>'
        elseif inline.t == "Math" then
            xml = string.format('<w:r><w:t xml:space="preserve">%s</w:t></w:r>', escape_xml(inline.text))
        end
        if xml then table.insert(parts, xml) end
    end
    return table.concat(parts)
end

-- ============================================================
-- Инлайн: Span (mark, highlight, background-color)
-- ============================================================
function Span(el)
    local style = get_style(el)
    local is_mark = has_class(el, "mark") or has_class(el, "highlight")
    local css = style and parse_css(style) or {}
    local rpr = build_rpr_elements(css)
    if is_mark then
        local has_bg = false
        for _, tag in ipairs(rpr) do
            if tag:find('<w:shd') then has_bg = true; break end
        end
        if not has_bg then
            table.insert(rpr, '<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/>')
        end
    end
    if #rpr == 0 then return nil end
    local runs = inject_rpr_into_runs(serialize_inlines(el.content), rpr)
    return pandoc.RawInline("openxml", runs)
end

-- ============================================================
-- Блочные элементы
-- ============================================================
local function block_to_raw_paragraph(block, extra_ppr_elements)
    extra_ppr_elements = extra_ppr_elements or {}
    local ppr = ""
    if #extra_ppr_elements > 0 then
        ppr = '<w:pPr>' .. table.concat(extra_ppr_elements) .. '</w:pPr>'
    end
    local runs = serialize_inlines(block.content)
    return pandoc.RawBlock("openxml", '<w:p>' .. ppr .. runs .. '</w:p>')
end

local function extract_block_ppr(css, is_header, header_level)
    local ppr = {}
    if is_header and header_level then
        table.insert(ppr, string.format('<w:pStyle w:val="Heading%d"/>', header_level))
    end
    if css["text-align"] then
        local jc = align_map[string.lower(css["text-align"])]
        if jc then table.insert(ppr, string.format('<w:jc w:val="%s"/>', jc)) end
    end
    local bg = css["background-color"] or css["background"]
    if bg then
        local hex = hex_color(bg)
        if hex then table.insert(ppr, string.format('<w:shd w:val="clear" w:color="auto" w:fill="%s"/>', hex)) end
    end
    return ppr
end

function Plain(el)
    debug_el("Plain", el)
    return el 
end

function Para(el)
    debug_el("Para", el)
    local style = get_style(el)
    local css = style and parse_css(style) or {}
    
    -- Читаем классы выравнивания, добавленные в route.ts
    if has_class(el, "text-left") then css["text-align"] = "left"
    elseif has_class(el, "text-center") then css["text-align"] = "center"
    elseif has_class(el, "text-right") then css["text-align"] = "right"
    elseif has_class(el, "text-justify") then css["text-align"] = "justify"
    end
    
    local ppr = extract_block_ppr(css, false, nil)
    
    -- 🚨 ИСПРАВЛЕНИЕ: Если нет кастомных стилей (выравнивание, фон), 
    -- возвращаем стандартный Para. Это критично для сохранения списков!
    if #ppr == 0 then
        return el
    end
    
    -- 🚨 ОТЛАДКА: Смотрим, применилось ли выравнивание к абзацу
    io.stderr:write("[DEBUG Para] ✅ Применяем pPr к абзацу: " .. table.concat(ppr) .. "\n")
    
    return block_to_raw_paragraph(el, ppr)
end

function Header(el)
    debug_el("Header", el)
    local style = get_style(el)
    local css = style and parse_css(style) or {}
    
    -- Читаем классы выравнивания для заголовков
    if has_class(el, "text-left") then css["text-align"] = "left"
    elseif has_class(el, "text-center") then css["text-align"] = "center"
    elseif has_class(el, "text-right") then css["text-align"] = "right"
    elseif has_class(el, "text-justify") then css["text-align"] = "justify"
    end
    
    local ppr_elements = extract_block_ppr(css, true, el.level)
    
    -- 🚨 ИСПРАВЛЕНИЕ: Переопределяем цвет заголовков на черный (000000),
    -- чтобы убрать стандартный синий цвет стилей Word (Heading1, Heading2 и т.д.)
    local runs_xml = serialize_inlines(el.content)
    -- Инжектим черный цвет во все runs заголовка
    runs_xml = inject_rpr_into_runs(runs_xml, {'<w:color w:val="000000"/>'})
    
    local ppr_str = ""
    if #ppr_elements > 0 then
        ppr_str = '<w:pPr>' .. table.concat(ppr_elements) .. '</w:pPr>'
    end
    
    -- 🚨 ОТЛАДКА: Смотрим, применилось ли выравнивание к заголовку
    if #ppr_elements > 0 then
        io.stderr:write("[DEBUG Header] ✅ Применяем pPr к заголовку: " .. table.concat(ppr_elements) .. "\n")
    end
    
    -- Собираем итоговый XML абзаца
    return pandoc.RawBlock("openxml", '<w:p>' .. ppr_str .. runs_xml .. '</w:p>')
end

function Div(el)
    -- 🚨 ОБРАБОТКА РАЗРЫВА СТРАНИЦЫ
    if has_class(el, "page-break") then
        -- Возвращаем сырой OpenXML для принудительного разрыва страницы
        return pandoc.RawBlock("openxml", '<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    end
    
    debug_el("Div", el)
    local style = get_style(el)
    local css = style and parse_css(style) or {}
    if has_class(el, "text-left") then css["text-align"] = "left"
    elseif has_class(el, "text-center") then css["text-align"] = "center"
    elseif has_class(el, "text-right") then css["text-align"] = "right"
    elseif has_class(el, "text-justify") then css["text-align"] = "justify"
    end
    local jc_val = align_map[string.lower(css["text-align"] or "")]
    local bg_hex = hex_color(css["background-color"] or css["background"])
    if not jc_val and not bg_hex then return nil end
    local ppr_elements = {}
    if jc_val then
        io.stderr:write("[DEBUG Div] Applying align: " .. jc_val .. "\n")
        table.insert(ppr_elements, string.format('<w:jc w:val="%s"/>', jc_val))
    end
    if bg_hex then
        table.insert(ppr_elements, string.format('<w:shd w:val="clear" w:color="auto" w:fill="%s"/>', bg_hex))
    end
    local new_content = {}
    for _, block in ipairs(el.content) do
        if block.t == "Para" or block.t == "Plain" then
            table.insert(new_content, block_to_raw_paragraph(block, ppr_elements))
        elseif block.t == "RawBlock" and block.format == "openxml" and #ppr_elements > 0 then
            -- 🚨 НОВАЯ ВЕТКА: Para уже сериализован в RawBlock, вставляем pPr в XML
            local raw_xml = block.text
            local extra_ppr = table.concat(ppr_elements)
            raw_xml = raw_xml:gsub('(<w:p>)(.-)(</w:p>)', function(open, body, close)
                if body:find('<w:pPr>') then
                    return open .. body:gsub('(<w:pPr>)', '%1' .. extra_ppr) .. close
                else
                    return open .. '<w:pPr>' .. extra_ppr .. '</w:pPr>' .. body .. close
                end
            end)
            io.stderr:write("[DEBUG Div] ✅ Injected pPr into RawBlock: " .. extra_ppr .. "\n")
            table.insert(new_content, pandoc.RawBlock("openxml", raw_xml))
        elseif block.t == "Header" then
            local header_ppr = { string.format('<w:pStyle w:val="Heading%d"/>', block.level) }
            for _, v in ipairs(ppr_elements) do table.insert(header_ppr, v) end
            table.insert(new_content, block_to_raw_paragraph(block, header_ppr))
        else
            table.insert(new_content, block)
        end
    end
    return pandoc.Div(new_content, el.attr)
end

-- ============================================================
-- ЦИТАТЫ (BlockQuote)
-- ============================================================
function BlockQuote(el)
    debug_el("BlockQuote", el)
    local new_content = {}
    
    -- 🚨 ИСПРАВЛЕНИЕ: Задаем падинги со всех 4 сторон
    local bq_styles = {
        -- ПАДДИНГ СВЕРХУ И СНИЗУ (240 twips ≈ 4.2 мм)
        '<w:spacing w:before="240" w:after="240"/>',
        
        -- ПАДДИНГ СЛЕВА И СПРАВА (240 twips ≈ 4.2 мм)
        -- В Word это делается через отступы (indents).
        '<w:ind w:left="240" w:right="240"/>',

        -- Левая рамка: single (сплошная), sz="24" (3 пункта), space="4" (отступ от текста), color="CCCCCC" (серый)
        '<w:left w:val="single" w:sz="24" w:space="8" w:color="CCCCCC"/>',
    }
    local bq_ppr_xml = '<w:pPr>' .. table.concat(bq_styles) .. '</w:pPr>'

    for _, block in ipairs(el.content) do
        if block.t == "RawBlock" and block.format == "openxml" then
            local raw_xml = block.text
            if raw_xml:find('<w:pPr>') then
                raw_xml = raw_xml:gsub('(<w:pPr>)', '%1' .. table.concat(bq_styles))
            else
                raw_xml = raw_xml:gsub('(<w:p>)', '%1' .. bq_ppr_xml)
            end
            table.insert(new_content, pandoc.RawBlock("openxml", raw_xml))
            
        elseif block.t == "Para" or block.t == "Plain" then
            local runs = serialize_inlines(block.content)
            table.insert(new_content, pandoc.RawBlock("openxml", '<w:p>' .. bq_ppr_xml .. runs .. '</w:p>'))
            
        elseif block.t == "Div" then
            table.insert(new_content, block) 
        else
            table.insert(new_content, block)
        end
    end
    
    return new_content 
end

-- ============================================================
-- ТАБЛИЦЫ
-- ============================================================
local border_xml = [[<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>
<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>
<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>]]

local none_border_xml = [[<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>]]


local function cell_get_col_dxa(cell)
    if not cell.attr or not cell.attr.classes then return nil end
    for _, c in ipairs(cell.attr.classes) do
        local m = c:match("^col%-dxa%-(%d+)$")
        if m then return tonumber(m) end
    end
    return nil
end

local function cell_has_class(cell, name)
    if not cell.attr or not cell.attr.classes then return false end
    for _, c in ipairs(cell.attr.classes) do
        if c == name then return true end
    end
    return false
end

local function cell_get_col_width(cell)
    if not cell.attr or not cell.attr.classes then return nil end
    for _, c in ipairs(cell.attr.classes) do
        local m = c:match("^col%-w%-(%d+)$")
        if m then return tonumber(m) end
    end
    return nil
end

local function cell_get_row_height(cell)
    if not cell.attr or not cell.attr.classes then return nil end
    for _, c in ipairs(cell.attr.classes) do
        local m = c:match("^row%-h%-(%d+)$")
        if m then return tonumber(m) end
    end
    return nil
end

local function serialize_cell_blocks(blocks, parent_align, parent_bg)
    local parts = {}
    for _, block in ipairs(blocks) do
        io.stderr:write(string.format("[DEBUG serialize_cell_blocks] block.t: %s, parent_align: %s\n", block.t, tostring(parent_align)))
    end
    
    for _, block in ipairs(blocks) do
        if block.t == "Para" or block.t == "Plain" then
            local ppr_elements = {}
            local current_align = parent_align
            local current_bg = parent_bg
            
            if block.attr and block.attr.classes then
                for _, c in ipairs(block.attr.classes) do
                    if c == "text-center" then current_align = "center"
                    elseif c == "text-right" then current_align = "right"
                    elseif c == "text-left" then current_align = "left"
                    elseif c == "text-justify" then current_align = "both"
                    end
                end
            end
            
            if current_align then
                table.insert(ppr_elements, string.format('<w:jc w:val="%s"/>', current_align))
            end
            if current_bg then
                local hex = hex_color(current_bg)
                if hex then table.insert(ppr_elements, string.format('<w:shd w:val="clear" w:color="auto" w:fill="%s"/>', hex)) end
            end
            
            local ppr = ""
            if #ppr_elements > 0 then
                ppr = '<w:pPr>' .. table.concat(ppr_elements) .. '</w:pPr>'
            end
            local runs = serialize_inlines(block.content)
            table.insert(parts, '<w:p>' .. ppr .. runs .. '</w:p>')
        elseif block.t == "Div" then
            local div_align = parent_align
            local div_bg = parent_bg
            if block.attr and block.attr.classes then
                for _, c in ipairs(block.attr.classes) do
                    if c == "text-center" then div_align = "center"
                    elseif c == "text-right" then div_align = "right"
                    elseif c == "text-left" then div_align = "left"
                    elseif c == "text-justify" then div_align = "both"
                    end
                end
            end
            if block.attr and block.attr.attributes and block.attr.attributes.style then
                local css = parse_css(block.attr.attributes.style)
                if css["background-color"] or css["background"] then
                    div_bg = css["background-color"] or css["background"]
                end
            end
            table.insert(parts, serialize_cell_blocks(block.content, div_align, div_bg))


        elseif block.t == "RawBlock" and block.format == "openxml" then
            local raw_xml = block.text
            -- 🚨 ОТЛАДКА
            io.stderr:write(string.format(
                "[DEBUG serialize_cell_blocks RawBlock] parent_align=%s, parent_bg=%s\n",
                tostring(parent_align), tostring(parent_bg)
            ))
            if parent_align then
                local jc = string.format('<w:jc w:val="%s"/>', parent_align)
                raw_xml = raw_xml:gsub('(<w:p>)(.-)(</w:p>)', function(open, body, close)
                    if body:find('<w:pPr>') then
                        return open .. body:gsub('(<w:pPr>)', '%1' .. jc) .. close
                    else
                        return open .. '<w:pPr>' .. jc .. '</w:pPr>' .. body .. close
                    end
                end)
            end
            if parent_bg then
                local hex = hex_color(parent_bg)
                if hex then
                    local shd = string.format('<w:shd w:val="clear" w:color="auto" w:fill="%s"/>', hex)
                    raw_xml = raw_xml:gsub('(<w:p>)(.-)(</w:p>)', function(open, body, close)
                        if body:find('<w:pPr>') then
                            return open .. body:gsub('(<w:pPr>)', '%1' .. shd) .. close
                        else
                            return open .. '<w:pPr>' .. shd .. '</w:pPr>' .. body .. close
                        end
                    end)
                end
            end
            table.insert(parts, raw_xml)

        else
            local doc = pandoc.Pandoc({block})
            local raw = pandoc.write(doc, 'docx')
            for p in raw:gmatch('<w:p[ >].-</w:p>') do
                table.insert(parts, p)
            end
        end
    end
    if #parts == 0 then
        table.insert(parts, '<w:p/>')
    end
    return table.concat(parts)
end

function Table(el)
    local xml = {}
    table.insert(xml, '<w:tbl>')

    -- 1. Собираем все строки (без изменений)
    local all_rows = {}
    local is_header_row = {}
    if el.head and el.head.rows then
        for _, row in ipairs(el.head.rows) do table.insert(all_rows, row); is_header_row[#all_rows] = true end
    end
    if el.bodies then
        for _, body_part in ipairs(el.bodies) do
            if body_part.head then for _, row in ipairs(body_part.head) do table.insert(all_rows, row); is_header_row[#all_rows] = true end end
            if body_part.body then for _, row in ipairs(body_part.body) do table.insert(all_rows, row) end end
        end
    end
    if el.foot and el.foot.rows then for _, row in ipairs(el.foot.rows) do table.insert(all_rows, row) end end
    if #all_rows == 0 then
        if el.headers then table.insert(all_rows, { cells = el.headers }); is_header_row[#all_rows] = true end
        if el.rows then for _, row in ipairs(el.rows) do table.insert(all_rows, { cells = row }) end end
    end

    -- 2. Считаем ширины колонок в dxa (используем новую функцию)
    local col_widths_dxa = {}
    local total_dxa = 0
    if #all_rows > 0 then
        local first_cells = all_rows[1].cells or {}
        for _, cell in ipairs(first_cells) do
            local w = cell_get_col_dxa(cell) or 0
            table.insert(col_widths_dxa, w)
            total_dxa = total_dxa + w
        end
    end

    -- 3. Формируем tblPr
    table.insert(xml, '<w:tblPr>')
    table.insert(xml, '<w:tblBorders>')
    table.insert(xml, none_border_xml)
    table.insert(xml, '</w:tblBorders>')

    -- ✅ Читаем data-total-dxa, который мы сгенерировали в route.ts
    local tbl_total_dxa = nil
    if el.attr and el.attr.attributes and el.attr.attributes["data-total-dxa"] then
        tbl_total_dxa = tonumber(el.attr.attributes["data-total-dxa"])
    end

    if tbl_total_dxa and tbl_total_dxa > 0 then
        -- ✅ ИСПОЛЬЗУЕМ АБСОЛЮТНУЮ ШИРИНУ (dxa), чтобы таблица не растягивалась на 100%
        table.insert(xml, string.format('<w:tblW w:w="%d" w:type="dxa"/>', tbl_total_dxa))
    else
        -- Если ширины не заданы, таблица на 100% ширины страницы
        table.insert(xml, '<w:tblW w:w="5000" w:type="pct"/>')
    end

    table.insert(xml, '<w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0"/>')
    table.insert(xml, '</w:tblPr>')

    -- 4. Формируем tblGrid (в dxa)
    if total_dxa > 0 then
        table.insert(xml, '<w:tblGrid>')
        for _, w_dxa in ipairs(col_widths_dxa) do
            table.insert(xml, string.format('<w:gridCol w:w="%d"/>', w_dxa))
        end
        table.insert(xml, '</w:tblGrid>')
    end

    -- 5. Обработка строк и ячеек
    for i, row in ipairs(all_rows) do
        table.insert(xml, '<w:tr>')
        local tr_pr = {}
        if is_header_row[i] then table.insert(tr_pr, '<w:tblHeader/>') end
        local cells = row.cells or {}
        local row_height = nil
        for _, cell in ipairs(cells) do
            row_height = cell_get_row_height(cell)
            if row_height then break end
        end
        if row_height then
            local twips = row_height * 15
            table.insert(tr_pr, string.format('<w:trHeight w:val="%d" w:hRule="atLeast"/>', twips))
        end
        if #tr_pr > 0 then table.insert(xml, '<w:trPr>' .. table.concat(tr_pr) .. '</w:trPr>') end
        
        for _, cell in ipairs(cells) do
            table.insert(xml, '<w:tc>')
            local tc_pr = {}
            local is_bordered = cell_has_class(cell, "bordered")
            
            -- ✅ Используем готовые dxa
            local col_w_dxa = cell_get_col_dxa(cell)
            local colspan = cell.col_span or 1
            local rowspan = cell.row_span or 1
            
            if col_w_dxa then
                table.insert(tc_pr, string.format('<w:tcW w:w="%d" w:type="dxa"/>', col_w_dxa))
            end
            
            local cell_style = get_style(cell)
            local cell_css = cell_style and parse_css(cell_style) or {}
            local cell_align = nil
            if cell.alignment and cell.alignment ~= "AlignDefault" then
                local align_str = cell.alignment:gsub("Align", ""):lower()
                cell_align = parse_align(align_str)
            end
            if not cell_align and cell.attr and cell.attr.classes then
                for _, c in ipairs(cell.attr.classes) do
                    if c:match("^text%-") then
                        local align_val = c:gsub("^text%-", "")
                        cell_align = parse_align(align_val)
                        if cell_align then break end
                    end
                end
            end
            if not cell_align and cell.attr and cell.attr.attributes and cell.attr.attributes.align then
                cell_align = parse_align(cell.attr.attributes.align)
            end
            if not cell_align and cell_css["text-align"] then
                cell_align = parse_align(cell_css["text-align"])
            end
            if cell_css["vertical-align"] then
                local va = string.lower(cell_css["vertical-align"])
                if va == "middle" then table.insert(tc_pr, '<w:vAlign w:val="center"/>')
                elseif va == "bottom" then table.insert(tc_pr, '<w:vAlign w:val="bottom"/>')
                elseif va == "top" then table.insert(tc_pr, '<w:vAlign w:val="top"/>') end
            end
            if is_bordered then
                table.insert(tc_pr, '<w:tcBorders>')
                table.insert(tc_pr, border_xml)
                table.insert(tc_pr, '</w:tcBorders>')
            end
            if colspan > 1 then table.insert(tc_pr, string.format('<w:gridSpan w:val="%d"/>', colspan)) end
            if rowspan > 1 then table.insert(tc_pr, '<w:vMerge w:val="restart"/>')
            elseif rowspan == 0 then table.insert(tc_pr, '<w:vMerge/>') end
            
            if #tc_pr > 0 then table.insert(xml, '<w:tcPr>' .. table.concat(tc_pr) .. '</w:tcPr>') end
            local cell_blocks = cell.contents or {}
            table.insert(xml, serialize_cell_blocks(cell_blocks, cell_align))
            table.insert(xml, '</w:tc>')
        end
        table.insert(xml, '</w:tr>')
    end
    table.insert(xml, '</w:tbl>')

    return pandoc.RawBlock('openxml', table.concat(xml, '\n'))
end

-- ============================================================
-- ГЛОБАЛЬНАЯ ОБРАБОТКА ДОКУМЕНТА (Настройка полей страницы)
-- ============================================================
function Pandoc(doc)
    -- Уменьшаем отступы (поля) страницы.
    -- Значения указаны в twips (1 twip = 1/1440 дюйма ≈ 0.0176 см).
    -- 720 twips = 1.27 см (0.5 дюйма). Можно поставить 567 (1 см) или 400.
    local sect_pr = [[
    <w:sectPr>
        <w:pgSz w:w="11906" w:h="16838"/>
        <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
    ]]
    -- Внедряем RawBlock в конец документа, Pandoc подхватит его как настройки секции
    table.insert(doc.blocks, pandoc.RawBlock('openxml', sect_pr))
    return doc
end